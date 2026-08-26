<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Tests\TestCase;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use GuzzleHttp\Handler\MockHandler;
use Illuminate\Support\Facades\Cache;
use Everest\Services\AI\ProviderFactory;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Psr7\Request as PsrRequest;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Services\AI\Providers\OllamaProvider;
use Everest\Services\AI\Inference\ProviderReadiness;
use Everest\Services\AI\Providers\OpenAiCompatibleProvider;

/**
 * The gate that stops a turn being accepted for a provider that is switched off.
 *
 * Everything here is about one failure. The panel admitted the turn, opened the
 * conversation, recorded the message and dispatched the job before anything
 * asked whether the endpoint was answering — so switching the provider off
 * produced a spinner that never resolved, an inference slot nobody could
 * reclaim, and a second message queued behind the first.
 */
class ProviderReadinessTest extends TestCase
{
    public function setUp(): void
    {
        parent::setUp();

        Cache::flush();
    }

    private function config(array $overrides = []): ProviderConfig
    {
        return new ProviderConfig(
            provider: $overrides['provider'] ?? ProviderConfig::PROVIDER_OLLAMA,
            endpoint: $overrides['endpoint'] ?? 'http://127.0.0.1:11434/v1',
            apiKey: $overrides['apiKey'] ?? '',
            model: $overrides['model'] ?? 'qwen3',
        );
    }

    /**
     * Readiness over a fixed connection, so these assert the gate rather than
     * the settings hydration that normally supplies it.
     */
    private function readinessFor(ProviderConfig $config): ProviderReadiness
    {
        return new ProviderReadiness(new class ($config) extends ProviderFactory {
            public function __construct(private ProviderConfig $fixed)
            {
            }

            public function config(): ProviderConfig
            {
                return $this->fixed;
            }
        });
    }

    private function handler(array $responses): HandlerStack
    {
        return HandlerStack::create(new MockHandler($responses));
    }

    /*
    |--------------------------------------------------------------------------
    | Configuration faults, which need no network
    |--------------------------------------------------------------------------
    */

    public function testAMissingEndpointOrModelIsRefusedWithItsOwnReason(): void
    {
        foreach (['endpoint', 'model'] as $missing) {
            $state = $this->readinessFor($this->config([$missing => '']))->state();

            $this->assertFalse($state['ready']);
            $this->assertStringContainsString($missing, (string) $state['reason']);
        }
    }

    public function testABlankKeyIsOnlyAFaultForProvidersThatRequireOne(): void
    {
        // Asked of the configuration check directly rather than through
        // `state()`, which would go on to probe: whether a blank key is a fault
        // must be settled without a network, since a host that requires a key
        // is exactly the one that is not local.
        $this->assertNull(
            $this->misconfiguration($this->config()),
            'Local servers are normally unauthenticated; a blank key is the ordinary case.',
        );

        $this->assertStringContainsString('API key', (string) $this->misconfiguration($this->config([
            'provider' => ProviderConfig::PROVIDER_ANTHROPIC,
            'endpoint' => 'https://api.anthropic.com/v1',
        ])));
    }

    private function misconfiguration(ProviderConfig $config): ?string
    {
        return (new \ReflectionMethod(ProviderReadiness::class, 'misconfiguration'))
            ->invoke($this->readinessFor($config), $config);
    }

    /*
    |--------------------------------------------------------------------------
    | What a live call teaches the gate
    |--------------------------------------------------------------------------
    */

    public function testACallThatComesBackMarksTheProviderReachable(): void
    {
        $config = $this->config();
        $provider = new OllamaProvider($config, $this->handler([
            new Response(200, [], (string) json_encode(['models' => [['name' => 'qwen3']]])),
        ]));

        $this->assertTrue($provider->health());
        $this->assertTrue($this->readinessFor($config)->state()['ready']);
    }

    public function testAConnectionThatNeverLandsMarksTheProviderUnreachable(): void
    {
        $config = $this->config();
        $provider = new OllamaProvider($config, $this->handler([
            new ConnectException('Connection refused', new PsrRequest('GET', 'http://127.0.0.1:11434/api/tags')),
        ]));

        $this->assertFalse($provider->health());

        $state = $this->readinessFor($config)->state();
        $this->assertFalse($state['ready']);
        $this->assertSame(ProviderReadiness::UNREACHABLE_MESSAGE, $state['reason']);
    }

    /**
     * The distinction that keeps this gate from locking people out of a host
     * that works: not every OpenAI-compatible server implements `/models`, and
     * a 404 there is an answer, not an outage.
     */
    public function testAnEndpointThatRefusesTheProbePathIsStillReachable(): void
    {
        $config = $this->config([
            'provider' => ProviderConfig::PROVIDER_OPENAI_COMPATIBLE,
            'endpoint' => 'http://127.0.0.1:8080/v1',
        ]);

        $provider = new OpenAiCompatibleProvider($config, $this->handler([
            new Response(404, [], '{"error":"not found"}'),
        ]));

        // The narrow question — did the probe path return a listing — is no.
        $this->assertFalse($provider->health());

        // The question this gate asks — is anything there — is yes.
        $this->assertTrue($this->readinessFor($config)->state()['ready']);
    }

    public function testAFailingServiceIsUnreachableButARejectedRequestIsNot(): void
    {
        $config = $this->config([
            'provider' => ProviderConfig::PROVIDER_OPENAI_COMPATIBLE,
            'endpoint' => 'http://127.0.0.1:8080/v1',
        ]);

        (new OpenAiCompatibleProvider($config, $this->handler([
            new Response(503, [], 'upstream unavailable'),
        ])))->health();

        $this->assertFalse($this->readinessFor($config)->state()['ready']);

        Cache::flush();

        (new OpenAiCompatibleProvider($config, $this->handler([
            new Response(401, [], '{"error":"bad key"}'),
        ])))->health();

        // A rejected credential is a real problem, but it is this caller's
        // problem. Refusing everybody else's turns over it would be wrong.
        $this->assertTrue($this->readinessFor($config)->state()['ready']);
    }

    /*
    |--------------------------------------------------------------------------
    | Cost, and what a verdict belongs to
    |--------------------------------------------------------------------------
    */

    public function testAKnownVerdictIsAnsweredFromCacheWithoutTouchingTheNetwork(): void
    {
        $config = $this->config();
        $readiness = $this->readinessFor($config);

        $readiness->markUnreachable($config, ProviderReadiness::UNREACHABLE_MESSAGE);

        // Nothing is mocked here, so a probe would open a real socket and pay
        // the connect timeout. Answering immediately is the whole point of
        // putting this on the send path.
        $before = microtime(true);
        $state = $readiness->state();

        $this->assertFalse($state['ready']);
        $this->assertLessThan(1.0, microtime(true) - $before);

        $readiness->markReachable($config);
        $this->assertTrue($readiness->state()['ready']);
    }

    /**
     * A verdict belongs to the connection it was reached about. Repointing the
     * endpoint, swapping the credential or changing the model asks again rather
     * than inheriting a judgement made about a different service.
     */
    public function testAVerdictDoesNotSurviveAChangeOfConnection(): void
    {
        $readiness = $this->readinessFor($this->config());
        $key = new \ReflectionMethod(ProviderReadiness::class, 'key');
        $mine = $key->invoke($readiness, $this->config());

        foreach ([
            ['endpoint' => 'http://elsewhere:11434/v1'],
            ['model' => 'llama3.1'],
            ['apiKey' => 'sk-something'],
        ] as $changed) {
            $this->assertNotSame(
                $mine,
                $key->invoke($readiness, $this->config($changed)),
                'A verdict must not be inherited across ' . array_key_first($changed) . '.',
            );
        }
    }
}
