<?php

namespace Everest\Services\AI\Inference;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Exceptions\Service\AI\AIServiceException;

/**
 * Is there anything on the other end of the configured AI provider?
 *
 * The panel already refused to start a turn for a provider that is misconfigured
 * or whose model cannot call tools, but neither of those questions is answered
 * against the network at the moment of asking: `capabilities()` is cached for
 * five minutes on Ollama, forever on a generic OpenAI-compatible endpoint, and
 * answered from a static table on Anthropic. So an endpoint that was working an
 * hour ago and has since been switched off still passed every gate. The turn was
 * admitted, the conversation opened, the message recorded, the job dispatched —
 * and then a worker sat on a socket that would never answer while the composer
 * span, the inference slot stayed held, and the next message queued behind it.
 *
 * This asks the one question those gates do not: is it answering *now*.
 *
 * Cheap enough to sit on the send path, by three separate mechanisms:
 *
 * - **A successful call is the probe.** Every inference request that comes back
 *   refreshes the marker, so an active conversation never probes at all — the
 *   turn that just worked is better evidence than a `/models` round trip.
 * - **A failed call is the probe too.** A transport error marks the provider
 *   unreachable immediately, so the send that follows an outage is refused from
 *   cache in microseconds rather than discovering the outage a second time.
 * - **Otherwise, at most one probe per window.** Only a first message after a
 *   quiet spell pays for one, and it pays with a short connect timeout rather
 *   than the generous read timeout a real turn needs.
 *
 * The unready window is deliberately shorter than the ready one. Being wrong
 * about "down" turns users away from a service that is back; being wrong about
 * "up" costs one turn that fails the slow way, which is what happened before
 * this existed.
 */
class ProviderReadiness
{
    /**
     * What whoever sends next is told. One sentence, shared by the probe and by
     * the driver's own failure path so the two cannot drift, and deliberately
     * free of anything the provider said: transport errors and response bodies
     * can echo the prompt, the tool results or the credential.
     */
    public const UNREACHABLE_MESSAGE = 'The AI service is not responding, so the assistant cannot answer right now. Your message was not sent — please try again in a moment.';

    protected const CACHE_PREFIX = 'ai:ready:';

    /** How long a reachable provider is trusted without re-asking. */
    protected const READY_TTL = 30;

    /** How long an unreachable one is refused before it gets another chance. */
    protected const UNREADY_TTL = 15;

    /**
     * The probe's own wall-clock bound. Well under the connect timeout a real
     * turn uses: this runs while somebody watches a composer, and an endpoint
     * that is black-holing packets must fail fast rather than spend the full
     * ten seconds proving it.
     */
    protected const PROBE_TIMEOUT = 4;

    public function __construct(private ProviderFactory $factory)
    {
    }

    /**
     * @throws AIServiceException when the provider cannot serve a turn
     */
    public function assertReady(): void
    {
        $state = $this->state();

        if (!$state['ready']) {
            throw new AIServiceException((string) $state['reason']);
        }
    }

    public function ready(): bool
    {
        return $this->state()['ready'];
    }

    /**
     * The provider's readiness, probing only when nothing recent is known.
     *
     * @return array{ready: bool, reason: string|null}
     */
    public function state(bool $fresh = false): array
    {
        $config = $this->factory->config();

        // Configuration faults are answered from the settings themselves. They
        // need no network, they cannot change while this request runs, and
        // caching them would only delay an operator's fix taking effect.
        $misconfigured = $this->misconfiguration($config);

        if ($misconfigured !== null) {
            return ['ready' => false, 'reason' => $misconfigured];
        }

        $key = $this->key($config);

        if (!$fresh) {
            $cached = Cache::get($key);

            if (is_array($cached) && isset($cached['ready'])) {
                return ['ready' => (bool) $cached['ready'], 'reason' => $cached['reason'] ?? null];
            }
        }

        return $this->probe($config);
    }

    /**
     * Record that the provider answered. Called from the driver on every
     * successful request, which is what keeps a busy assistant off the probe
     * path entirely.
     */
    public function markReachable(ProviderConfig $config): void
    {
        Cache::put($this->key($config), ['ready' => true, 'reason' => null], self::READY_TTL);
    }

    /**
     * Record that it did not. The reason is shown to whoever sends next, so it
     * must be a sentence written for them rather than a transport error —
     * provider messages can echo the prompt and are never repeated here.
     */
    public function markUnreachable(ProviderConfig $config, string $reason): void
    {
        Cache::put($this->key($config), ['ready' => false, 'reason' => $reason], self::UNREADY_TTL);
    }

    /**
     * Drop what is known, so the next ask probes. For the admin connection test,
     * where an operator pressing "test" is explicitly asking to find out whether
     * their fix worked.
     */
    public function forget(?ProviderConfig $config = null): void
    {
        Cache::forget($this->key($config ?? $this->factory->config()));
    }

    /**
     * The message for a provider that cannot work regardless of reachability,
     * or null when nothing is obviously wrong with the configuration.
     */
    protected function misconfiguration(ProviderConfig $config): ?string
    {
        if ($config->endpoint === '') {
            return 'No AI service endpoint is configured, so the assistant cannot answer.';
        }

        if ($config->model === '') {
            return 'No AI model has been selected, so the assistant cannot answer.';
        }

        if ($config->requiresApiKey() && $config->apiKey === '') {
            return 'The AI provider has no API key configured, so the assistant cannot answer.';
        }

        return null;
    }

    /**
     * @return array{ready: bool, reason: string|null}
     */
    protected function probe(ProviderConfig $config): array
    {
        $key = $this->key($config);

        // Cleared first so what is read back afterwards can only have come from
        // the call below.
        Cache::forget($key);

        try {
            $ok = $this->factory
                ->fromConfig($config->withTimeout(self::PROBE_TIMEOUT))
                ->health();
        } catch (\Throwable $e) {
            // `health()` is contracted not to throw, so reaching here means the
            // driver could not even be built. Logged without the message: a
            // configuration exception can carry the endpoint and credential.
            Log::warning('AI readiness probe could not run.', ['exception' => $e::class]);

            $ok = false;
        }

        // The driver's own verdict wins where it has one, because it saw the
        // response and this did not. `health()` answers a narrower question —
        // "did the probe path return what I expected" — and folds a refused or
        // absent `/models` in with a host that is switched off. Whether the
        // request reached a server at all is the question being asked here, and
        // the transport layer is the only place it is actually known.
        $marked = Cache::get($key);

        if (is_array($marked) && isset($marked['ready'])) {
            return ['ready' => (bool) $marked['ready'], 'reason' => $marked['reason'] ?? null];
        }

        $state = $ok
            ? ['ready' => true, 'reason' => null]
            : ['ready' => false, 'reason' => self::UNREACHABLE_MESSAGE];

        Cache::put($key, $state, $ok ? self::READY_TTL : self::UNREADY_TTL);

        return $state;
    }

    /**
     * Keyed on the connection fingerprint, so changing the endpoint, the
     * credential or the model asks again rather than inheriting a verdict
     * reached about a different service.
     */
    protected function key(ProviderConfig $config): string
    {
        return self::CACHE_PREFIX . $config->fingerprint();
    }
}
