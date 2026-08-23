<?php

namespace Everest\Tests\Unit\Http\Requests\Api\Application\Intelligence;

use Everest\Tests\TestCase;
use Everest\Services\AI\ProviderFactory;
use Illuminate\Support\Facades\Validator;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Http\Requests\Api\Application\Intelligence\UpdateIntelligenceSettingsRequest;

/**
 * The endpoint and API key are a single slot shared by every provider rather
 * than one slot each, so both the validation tier and the carry-over rules
 * depend on which provider is in play. These cover the seams where the two
 * disagree.
 */
class UpdateIntelligenceSettingsRequestTest extends TestCase
{
    /**
     * Stand in for the settings-backed factory so these stay unit tests.
     */
    private function storedProvider(string $provider): void
    {
        $factory = \Mockery::mock(ProviderFactory::class);
        $factory->shouldReceive('provider')->andReturn($provider);

        $this->app->instance(ProviderFactory::class, $factory);
    }

    private function request(array $payload): UpdateIntelligenceSettingsRequest
    {
        $request = UpdateIntelligenceSettingsRequest::create('/', 'PUT', $payload);
        $request->setContainer($this->app);

        return $request;
    }

    private function errors(UpdateIntelligenceSettingsRequest $request): array
    {
        return Validator::make($request->all(), $request->rules())->errors()->keys();
    }

    public function testPlainHttpIsRejectedForAHostedProvider(): void
    {
        $this->storedProvider(ProviderConfig::PROVIDER_OLLAMA);

        $errors = $this->errors($this->request([
            'provider' => ProviderConfig::PROVIDER_ANTHROPIC,
            'endpoint' => 'http://192.168.1.154:11434',
        ]));

        $this->assertContains('endpoint', $errors);
    }

    public function testPlainHttpIsAcceptedForASelfHostedProvider(): void
    {
        $this->storedProvider(ProviderConfig::PROVIDER_ANTHROPIC);

        $errors = $this->errors($this->request([
            'provider' => ProviderConfig::PROVIDER_OLLAMA,
            'endpoint' => 'http://192.168.1.154:11434',
        ]));

        $this->assertNotContains('endpoint', $errors);
    }

    /**
     * A save that touches the endpoint but not the provider must be judged
     * against the stored provider. Falling back to an empty string would read
     * as "hosted" and demand HTTPS of a perfectly valid local address.
     */
    public function testEndpointWithoutAProviderIsJudgedAgainstTheStoredProvider(): void
    {
        $this->storedProvider(ProviderConfig::PROVIDER_OLLAMA);

        $errors = $this->errors($this->request(['endpoint' => 'http://192.168.1.154:11434']));

        $this->assertNotContains('endpoint', $errors);
    }

    public function testCredentialsInTheAuthorityAreRejected(): void
    {
        $this->storedProvider(ProviderConfig::PROVIDER_ANTHROPIC);

        $errors = $this->errors($this->request([
            'provider' => ProviderConfig::PROVIDER_ANTHROPIC,
            'endpoint' => 'https://user:pass@api.anthropic.com/v1',
        ]));

        $this->assertContains('endpoint', $errors);
    }

    public function testChangingProviderBlanksAnUnsuppliedEndpointAndKey(): void
    {
        $this->storedProvider(ProviderConfig::PROVIDER_OLLAMA);

        $normalized = $this->request(['provider' => ProviderConfig::PROVIDER_ANTHROPIC])->normalize();

        $this->assertSame('', $normalized['endpoint'], 'A stale Ollama address must not survive a switch to Anthropic.');
        $this->assertSame('', $normalized['key'], 'A key belongs to the provider it was issued by.');
    }

    public function testChangingProviderKeepsValuesSuppliedInTheSameRequest(): void
    {
        $this->storedProvider(ProviderConfig::PROVIDER_OLLAMA);

        $normalized = $this->request([
            'provider' => ProviderConfig::PROVIDER_ANTHROPIC,
            'endpoint' => 'https://api.anthropic.com/v1',
            'key' => 'sk-ant-example',
        ])->normalize();

        $this->assertSame('https://api.anthropic.com/v1', $normalized['endpoint']);
        $this->assertSame('sk-ant-example', $normalized['key']);
    }

    /**
     * Re-saving the same provider is the common case — it must not wipe the
     * key the admin is not retyping.
     */
    public function testKeepingTheProviderLeavesTheEndpointAndKeyUntouched(): void
    {
        $this->storedProvider(ProviderConfig::PROVIDER_OLLAMA);

        $normalized = $this->request([
            'provider' => ProviderConfig::PROVIDER_OLLAMA,
            'model' => 'qwen3:8b',
        ])->normalize();

        $this->assertArrayNotHasKey('endpoint', $normalized);
        $this->assertArrayNotHasKey('key', $normalized);
        $this->assertSame('qwen3:8b', $normalized['model']);
    }

    /**
     * Absent means untouched — a partial save must not blank every field the
     * form did not send.
     */
    public function testNormalizeOnlyEmitsSuppliedKeysAndFlattensNesting(): void
    {
        $this->storedProvider(ProviderConfig::PROVIDER_OLLAMA);

        $normalized = $this->request([
            'agent' => ['max_steps' => 8],
            'privacy' => ['enabled' => true],
        ])->normalize();

        $this->assertSame([
            'agent:max_steps' => 8,
            'privacy:enabled' => true,
        ], $normalized);
    }
}
