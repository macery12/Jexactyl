<?php

namespace Everest\Http\Controllers\Api\Application;

use Everest\Models\Setting;
use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Inference\InferenceGate;
use Everest\Services\AI\Providers\OllamaProvider;
use Everest\Services\AI\Tools\ConsoleCommandGate;
use Everest\Services\AI\Tools\Definitions\ServerTools;
use Everest\Http\Requests\Api\Application\Intelligence\UpdateAiToolsRequest;
use Everest\Http\Requests\Api\Application\Intelligence\GetIntelligenceRequest;

/**
 * Admin surface for the agent: what it may call, at what tier, and how loaded
 * the inference backend is.
 *
 * Separate from IntelligenceController because that one governs the model
 * connection; this one governs the tool layer, and the two are edited by
 * different people at different times.
 */
class AiAgentController extends ApplicationApiController
{
    public function __construct(
        private ToolRegistry $registry,
        private RiskGate $riskGate,
        private ConsoleCommandGate $consoleGate,
        private InferenceGate $inferenceGate,
        private ProviderFactory $factory,
    ) {
        parent::__construct();
    }

    /**
     * The tool catalogue, with each tool's declared tier alongside the tier it
     * actually runs at, so an operator can see at a glance what they changed.
     */
    public function tools(GetIntelligenceRequest $request): JsonResponse
    {
        $overrides = $this->riskGate->overrides();
        $disabled = $this->riskGate->disabledTools();

        $tools = [];

        foreach ($this->registry->all() as $definition) {
            $tools[] = [
                'name' => $definition->name,
                'description' => $definition->description,
                'scope' => $definition->scope,
                'group' => $definition->group,
                'method' => $definition->method,
                'default_risk' => $definition->risk,
                'risk' => $overrides[$definition->name] ?? $definition->risk,
                'overridden' => isset($overrides[$definition->name]),
                'enabled' => !in_array($definition->name, $disabled, true),
                'permissions' => $definition->permissions,
            ];
        }

        return response()->json([
            'data' => $tools,
            'groups' => ServerTools::GROUP_DESCRIPTIONS,
            'risks' => ToolDefinition::RISKS,
            'console' => [
                // The built-in list is returned separately from the additions so
                // the editor can show what it is adding to rather than
                // presenting the defaults as user-entered text.
                'defaults' => ConsoleCommandGate::DEFAULT_SAFE,
                'extra' => $this->consoleExtras(),
            ],
        ]);
    }

    /**
     * Save tier overrides, disabled tools, and console allowlist additions.
     */
    public function updateTools(UpdateAiToolsRequest $request): Response
    {
        $known = array_keys($this->registry->all());

        // Unknown names are dropped rather than rejected: a tool can disappear
        // between the editor loading and the operator saving, and losing the
        // rest of their edits over a stale row would be the worse outcome.
        $overrides = array_filter(
            (array) $request->input('risk_overrides', []),
            fn ($risk, $name) => in_array($name, $known, true) && in_array($risk, ToolDefinition::RISKS, true),
            ARRAY_FILTER_USE_BOTH
        );

        $disabled = array_values(array_intersect(
            array_filter((array) $request->input('disabled_tools', []), 'is_string'),
            $known
        ));

        $console = array_values(array_unique(array_filter(array_map(
            fn ($value) => is_string($value) ? strtolower(trim($value)) : '',
            (array) $request->input('console_safe_commands', [])
        ))));

        Setting::set('settings::modules:ai:risk_overrides', json_encode($overrides));
        Setting::set('settings::modules:ai:disabled_tools', json_encode($disabled));
        Setting::set('settings::modules:ai:console:safe_commands', json_encode($console));

        Activity::event('admin:ai:tools')
            ->property('overrides', $overrides)
            ->property('disabled', $disabled)
            ->property('console_safe_commands', $console)
            ->description('AI agent tool policy was updated')
            ->log();

        return $this->returnNoContent();
    }

    /**
     * Live admission-control state, plus whether the configured model can
     * actually call tools.
     *
     * The capability probe is the one number that decides whether the agent
     * runs at all, so it belongs on the same card as the queue depth rather
     * than buried in a connection test.
     */
    public function inference(GetIntelligenceRequest $request): JsonResponse
    {
        $payload = [
            'queue' => $this->inferenceGate->stats(),
            'average_turn_ms' => $this->inferenceGate->averageTurnMs(),
            'resident_models' => [],
            'capabilities' => null,
        ];

        try {
            $model = $this->factory->model(ProviderFactory::TASK_AGENT);
            $provider = $this->factory->make(ProviderFactory::TASK_AGENT);

            $capabilities = $provider->capabilities($model);

            $payload['capabilities'] = [
                'model' => $model,
                'supports_tools' => $capabilities->supportsTools,
                'self_hosted' => $capabilities->selfHosted,
                'max_context_tokens' => $capabilities->maxContextTokens,
                'warnings' => $capabilities->warnings,
            ];

            // Which models are actually resident is the difference between a
            // slow first token and a cold thirty-second load; only Ollama
            // reports it.
            if ($provider instanceof OllamaProvider) {
                $payload['resident_models'] = $provider->runningModels();
            }
        } catch (\Throwable $e) {
            Log::debug('AI inference probe failed: ' . $e->getMessage());
            $payload['error'] = $e->getMessage();
        }

        return response()->json($payload);
    }

    /**
     * Operator additions only — the built-in list is returned separately.
     */
    private function consoleExtras(): array
    {
        $stored = Setting::get('settings::modules:ai:console:safe_commands');

        if (!is_string($stored) || $stored === '') {
            return [];
        }

        $decoded = json_decode($stored, true);

        return is_array($decoded) ? array_values(array_filter($decoded, 'is_string')) : [];
    }
}
