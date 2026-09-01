<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\Setting;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Tools\Definitions\AdminTools;
use Everest\Services\AI\Tools\Definitions\ServerTools;
use Everest\Services\AI\Tools\Definitions\SharedTools;

/**
 * How many complete tool schemas this model can choose between in one step.
 *
 * A context window says how much a model can *hold*, not how many similar
 * options it can *discriminate between* — a 3B model with a 128K window still
 * calls the first tool whose schema parses when handed twenty. So the budget
 * comes from exact parameter metadata first, then a recognizable model name,
 * with provider-family and quantized-byte fallbacks. The profile table is a
 * starting point to be measured rather than a capability claim.
 *
 * `agent:max_tools` overrides it. Left unset it means "work it out," the useful
 * default: an operator installing a panel does not know their model's ceiling.
 */
class ToolBudget
{
    public const PROFILE_TINY = 'tiny';
    public const PROFILE_SMALL = 'small';
    public const PROFILE_MEDIUM = 'medium';
    public const PROFILE_LARGE = 'large';
    public const PROFILE_FRONTIER = 'frontier';
    public const PROFILE_MANUAL = 'manual';
    public const PROFILE_CALIBRATED = 'calibrated';

    /**
     * Schemas per step, and search results per query, for each profile.
     *
     * The result count is not simply "as many as fit". Every result is a
     * candidate for the working set, so a search returning eight on a profile
     * that can hold eight would replace the entire set on one call — which is the
     * silent-eviction failure this design exists to end, arriving through the
     * front door instead.
     */
    private const PROFILES = [
        // Six leaves room for every phase's reserved set and several task tools;
        // Tiny also omits the two nonessential host controls from its base set.
        self::PROFILE_TINY => ['schemas' => 6, 'results' => 3],
        self::PROFILE_SMALL => ['schemas' => 8, 'results' => 3],
        self::PROFILE_MEDIUM => ['schemas' => 12, 'results' => 5],
        self::PROFILE_LARGE => ['schemas' => 20, 'results' => 8],
        // Resolved dynamically so adding a registered capability cannot
        // silently put it behind discovery for hosted providers.
        self::PROFILE_FRONTIER => ['schemas' => 0, 'results' => 8],
    ];

    /**
     * The floor, whatever anyone configures.
     *
     * Discovery and safety controls are offered in addition to this number:
     * search_tools and ask_user on Tiny, with load_tools and batch added above
     * Tiny. Four capability slots is the smallest useful manual working set;
     * Auto uses six so every phase remains navigable.
     */
    public const MIN_SCHEMAS = 4;

    private ?string $profile = null;

    private ?int $schemas = null;

    private ?string $source = null;

    private ?string $confidence = null;

    private ?string $reason = null;

    private ?int $parameterCount = null;

    public function __construct(
        private ProviderFactory $factory,
        private ModelToolProfileDetector $detector,
        private ToolBudgetCalibration $calibration,
    ) {
    }

    /**
     * Complete tool schemas the model may be offered in one step.
     */
    public function schemas(): int
    {
        $this->resolve();

        return $this->schemas;
    }

    /**
     * Results one `search_tools` call may return.
     *
     * Derived from the manual setting rather than fixed, so an operator who
     * halves the budget for a struggling model gets a proportionally quieter
     * search rather than one that keeps trying to fill a set it cannot fill.
     */
    public function results(): int
    {
        $this->resolve();

        if (in_array($this->profile, [self::PROFILE_MANUAL, self::PROFILE_CALIBRATED], true)) {
            return max(3, min(8, (int) ceil($this->schemas / 4)));
        }

        return self::PROFILES[$this->profile]['results'];
    }

    /**
     * Which profile was chosen, for the admin page and the discovery log.
     */
    public function profile(): string
    {
        $this->resolve();

        return $this->profile;
    }

    /** Explicit operator value, or null while automatic detection is active. */
    public function manualSchemas(): ?int
    {
        $this->resolve();

        return $this->profile === self::PROFILE_MANUAL ? $this->schemas : null;
    }

    /** Total schemas the model sees, including discovery and safety controls. */
    public function totalSchemas(): int
    {
        return $this->schemas() + count(SharedTools::alwaysOfferedFor($this->schemas()));
    }

    public function source(): string
    {
        $this->resolve();

        return $this->source;
    }

    public function confidence(): string
    {
        $this->resolve();

        return $this->confidence;
    }

    public function reason(): string
    {
        $this->resolve();

        return $this->reason;
    }

    public function parameterCount(): ?int
    {
        $this->resolve();

        return $this->parameterCount;
    }

    /** Re-read operator settings or a calibration saved during this process. */
    public function forgetResolvedProfile(): void
    {
        $this->profile = null;
        $this->schemas = null;
        $this->source = null;
        $this->confidence = null;
        $this->reason = null;
        $this->parameterCount = null;
    }

    private function resolve(): void
    {
        if ($this->profile !== null) {
            return;
        }

        $configured = Setting::get(
            'settings::modules:ai:agent:max_tools',
            config('modules.ai.agent.max_tools')
        );

        // An explicit number always wins. Nothing here second-guesses it: an
        // operator who measured their model knows more than a size bucket does.
        if ($configured !== null && $configured !== '' && (int) $configured > 0) {
            $this->profile = self::PROFILE_MANUAL;
            $this->schemas = max(self::MIN_SCHEMAS, (int) $configured);
            $this->source = self::PROFILE_MANUAL;
            $this->confidence = ModelToolProfileDetector::CONFIDENCE_HIGH;
            $this->reason = 'Using the tool limit set by the operator.';

            return;
        }

        try {
            $measured = $this->calibration->find($this->factory->config());
        } catch (\Throwable) {
            $measured = null;
        }

        if ($measured !== null) {
            $this->profile = self::PROFILE_CALIBRATED;
            $this->schemas = max(self::MIN_SCHEMAS, (int) $measured['schemas']);
            $this->source = self::PROFILE_CALIBRATED;
            $this->confidence = ModelToolProfileDetector::CONFIDENCE_HIGH;
            $this->reason = 'Using the repeated tool-selection calibration saved for this exact provider, endpoint, model, and reasoning mode. This measures schema selection capacity, not safety or task completion.';

            return;
        }

        $detected = $this->detect();
        $this->profile = $detected['profile'];
        $this->schemas = $this->profile === self::PROFILE_FRONTIER
            ? self::fullCapabilityCount()
            : self::PROFILES[$this->profile]['schemas'];
        $this->source = $detected['source'];
        $this->confidence = $detected['confidence'];
        $this->reason = $detected['reason'];
        $this->parameterCount = $detected['parameter_count'];
    }

    /**
     * Work out the profile from what the provider will tell us about the model.
     *
     * Probing must never be able to break a turn. The detector can still use the
     * configured provider and model name after an endpoint failure; a completely
     * unknown local model receives the conservative small profile, while an
     * hosted provider receives the complete permitted tool surface. The settings
     * page exposes the source and confidence so an operator can see and override
     * that decision.
     */
    private function detect(): array
    {
        $provider = '';
        $model = '';

        try {
            $provider = $this->factory->provider();
            $model = $this->factory->model();
            $capabilities = $this->factory->make()->capabilities($model);
        } catch (\Throwable) {
            return $this->detector->detect($provider, $model);
        }

        return $this->detector->detect($provider, $model, $capabilities);
    }

    /**
     * The profile table, for the admin settings page.
     *
     * @return array<string, array{schemas: int, results: int}>
     */
    public static function profiles(): array
    {
        $profiles = self::PROFILES;
        $profiles[self::PROFILE_FRONTIER]['schemas'] = self::fullCapabilityCount();

        return $profiles;
    }

    /**
     * A hosted request can only see one permission-filtered surface at a time,
     * but budgeting for every registered non-host capability is a cheap,
     * future-proof upper bound. Shared controls are added separately.
     */
    private static function fullCapabilityCount(): int
    {
        return count(ServerTools::all()) + count(AdminTools::all());
    }
}
