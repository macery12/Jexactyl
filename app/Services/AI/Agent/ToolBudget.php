<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\Setting;
use Everest\Services\AI\ProviderFactory;

/**
 * How many complete tool schemas this model can choose between in one step.
 *
 * A context window says how much a model can *hold*, not how many similar
 * options it can *discriminate between* — a 3B model with a 128K window still
 * calls the first tool whose schema parses when handed twenty. So the budget
 * comes from model size first and window second, and the profile table is a
 * starting point to be measured rather than a capability claim.
 *
 * `agent:max_tools` overrides it. Left unset it means "work it out," the useful
 * default: an operator installing a panel does not know their model's ceiling.
 */
class ToolBudget
{
    public const PROFILE_SMALL = 'small';
    public const PROFILE_MEDIUM = 'medium';
    public const PROFILE_LARGE = 'large';
    public const PROFILE_FRONTIER = 'frontier';
    public const PROFILE_MANUAL = 'manual';

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
        self::PROFILE_SMALL => ['schemas' => 8, 'results' => 3],
        self::PROFILE_MEDIUM => ['schemas' => 12, 'results' => 5],
        self::PROFILE_LARGE => ['schemas' => 20, 'results' => 8],
        self::PROFILE_FRONTIER => ['schemas' => 32, 'results' => 8],
    ];

    /**
     * Size thresholds, in bytes as Ollama reports them — quantised on-disk weights,
     * not parameter counts. Roughly 8B and 20B at common quantisations.
     */
    private const SMALL_MAX_BYTES = 6 * 1024 * 1024 * 1024;
    private const MEDIUM_MAX_BYTES = 14 * 1024 * 1024 * 1024;

    /**
     * The floor, whatever anyone configures.
     *
     * Four is the size of `ALWAYS_OFFERED`. Below it the agent cannot see the
     * tool that finds tools, which is not a small model — it is a broken one.
     */
    public const MIN_SCHEMAS = 4;

    private ?string $profile = null;

    private ?int $schemas = null;

    public function __construct(private ProviderFactory $factory)
    {
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

        if ($this->profile === self::PROFILE_MANUAL) {
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

            return;
        }

        $this->profile = $this->detect();
        $this->schemas = self::PROFILES[$this->profile]['schemas'];
    }

    /**
     * Work out the profile from what the provider will tell us about the model.
     *
     * Probing must never be able to break a turn, so every failure — an
     * unreachable Ollama, a provider with no capability endpoint, a model that
     * reports no size — lands on medium. That is the honest answer to "we do not
     * know": small enough that a weak model is not overwhelmed, large enough that
     * a capable one is not crippled, and wrong in a way an operator can see and
     * correct on the settings page.
     */
    private function detect(): string
    {
        try {
            $model = $this->factory->model();
            $capabilities = $this->factory->make()->capabilities($model);
        } catch (\Throwable) {
            return self::PROFILE_MEDIUM;
        }

        // A hosted frontier model is not sized in bytes and does not need to be.
        if (!$capabilities->selfHosted) {
            return self::PROFILE_FRONTIER;
        }

        $bytes = $capabilities->modelSizeBytes;

        if ($bytes === null || $bytes <= 0) {
            // No size reported. A generous context window is weak evidence of a
            // capable model — weak enough to move one step, not two.
            return ($capabilities->maxContextTokens ?? 0) >= 65_536
                ? self::PROFILE_LARGE
                : self::PROFILE_MEDIUM;
        }

        if ($bytes < self::SMALL_MAX_BYTES) {
            return self::PROFILE_SMALL;
        }

        return $bytes < self::MEDIUM_MAX_BYTES ? self::PROFILE_MEDIUM : self::PROFILE_LARGE;
    }

    /**
     * The profile table, for the admin settings page.
     *
     * @return array<string, array{schemas: int, results: int}>
     */
    public static function profiles(): array
    {
        return self::PROFILES;
    }
}
