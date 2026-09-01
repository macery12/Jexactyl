<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use GuzzleHttp\Middleware;
use Everest\Tests\TestCase;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use GuzzleHttp\Handler\MockHandler;
use Everest\Services\AI\Data\AiTool;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Data\AiRequest;
use Everest\Services\AI\Data\AiToolCall;
use Everest\Services\AI\Agent\AgentEvent;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Data\AiStreamEvent;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Services\AI\Providers\OllamaProvider;
use Everest\Services\AI\Providers\AnthropicProvider;

/**
 * The reasoning channel: what the model thinks, shown to the user and — on
 * Anthropic — handed back to the API.
 *
 * The round trip is the part worth guarding. Anthropic signs each thinking block
 * and verifies that signature against the block's exact text on the next
 * request, so a turn that drops, reorders or rewrites its own thinking does not
 * degrade quietly: it 400s. That path runs through a JSON column and a
 * suspension, which is three chances to lose it.
 */
class ReasoningChannelTest extends TestCase
{
    /** @var array<int, array> */
    private array $history = [];

    private function stack(array $responses): HandlerStack
    {
        $this->history = [];
        $stack = HandlerStack::create(new MockHandler($responses));
        $stack->push(Middleware::history($this->history));

        return $stack;
    }

    private function sentPayload(int $index = 0): array
    {
        return json_decode((string) $this->history[$index]['request']->getBody(), true) ?? [];
    }

    private function config(string $model = 'claude-sonnet-5'): ProviderConfig
    {
        return new ProviderConfig(
            provider: ProviderConfig::PROVIDER_ANTHROPIC,
            endpoint: 'https://api.anthropic.com/v1',
            apiKey: 'sk-ant-test',
            model: $model,
            maxTokens: 1024,
            temperature: 0.3,
            systemPrompt: 'You are a test.',
            contextTokens: 200000,
        );
    }

    private function anthropic(HandlerStack $stack, string $model = 'claude-sonnet-5'): AnthropicProvider
    {
        return new AnthropicProvider($this->config($model), $stack);
    }

    private function ok(): Response
    {
        return new Response(200, [], json_encode([
            'content' => [['type' => 'text', 'text' => 'done']],
            'stop_reason' => 'end_turn',
        ]));
    }

    private function sse(array $frames): string
    {
        $sse = '';
        foreach ($frames as $frame) {
            $sse .= 'event: ' . $frame['event'] . "\n" . 'data: ' . json_encode($frame['data']) . "\n\n";
        }

        return $sse;
    }

    /*
    |--------------------------------------------------------------------------
    | Anthropic — the request
    |--------------------------------------------------------------------------
    */

    public function testReasoningAsksForAdaptiveThinking(): void
    {
        $stack = $this->stack([$this->ok()]);

        $this->anthropic($stack)->chat((new AiRequest([AiMessage::user('x')]))->withReasoning());

        $this->assertSame(['type' => 'adaptive'], $this->sentPayload()['thinking'] ?? null);
    }

    /**
     * Sampling parameters and thinking are mutually exclusive. This model
     * rejects temperature outright, but the pairing has to hold for the models
     * that accept it too — otherwise turning reasoning on would 400 every turn
     * on exactly the models where it was safe before.
     */
    public function testThinkingDisplacesTemperatureEvenWhereTemperatureIsAllowed(): void
    {
        $stack = $this->stack([$this->ok(), $this->ok()]);
        $provider = $this->anthropic($stack, 'claude-haiku-4-5');

        // Distinct prompts on purpose: an identical second request is served
        // from the response cache and never reaches the transport.
        $provider->chat(new AiRequest([AiMessage::user('plain')], temperature: 0.0));
        $this->assertArrayHasKey('temperature', $this->sentPayload(0));

        // Haiku 4.5 has no adaptive thinking, so asking for it must change
        // nothing rather than stripping a parameter the model still needs.
        $provider->chat((new AiRequest([AiMessage::user('reasoning')], temperature: 0.0))->withReasoning());
        $this->assertArrayHasKey('temperature', $this->sentPayload(1));
        $this->assertArrayNotHasKey('thinking', $this->sentPayload(1));
    }

    public function testThinkingModelsDropTemperature(): void
    {
        $stack = $this->stack([$this->ok()]);

        $this->anthropic($stack)->chat((new AiRequest([AiMessage::user('x')], temperature: 0.0))->withReasoning());

        $this->assertArrayNotHasKey('temperature', $this->sentPayload());
    }

    /**
     * `max_tokens` bounds thinking and the answer together. Left at the panel
     * default — sized for a chat reply — a model would spend the whole budget
     * thinking and stop with its tool call half-written.
     */
    public function testReasoningRaisesTheOutputCeiling(): void
    {
        $stack = $this->stack([$this->ok(), $this->ok()]);
        $provider = $this->anthropic($stack);

        $provider->chat(new AiRequest([AiMessage::user('plain')]));
        $this->assertSame(1024, $this->sentPayload(0)['max_tokens']);

        $provider->chat((new AiRequest([AiMessage::user('reasoning')]))->withReasoning());
        $this->assertGreaterThan(4096, $this->sentPayload(1)['max_tokens']);
    }

    public function testReasoningIsOffUnlessAskedFor(): void
    {
        $stack = $this->stack([$this->ok()]);

        $this->anthropic($stack)->chat(new AiRequest([AiMessage::user('x')]));

        $this->assertArrayNotHasKey('thinking', $this->sentPayload());
    }

    /*
    |--------------------------------------------------------------------------
    | Anthropic — the stream
    |--------------------------------------------------------------------------
    */

    public function testThinkingStreamsSeparatelyFromTheAnswer(): void
    {
        $stack = $this->stack([new Response(200, [], $this->sse([
            ['event' => 'content_block_start', 'data' => ['type' => 'content_block_start', 'index' => 0, 'content_block' => ['type' => 'thinking', 'thinking' => '']]],
            ['event' => 'content_block_delta', 'data' => ['type' => 'content_block_delta', 'index' => 0, 'delta' => ['type' => 'thinking_delta', 'thinking' => 'The user wants ']]],
            ['event' => 'content_block_delta', 'data' => ['type' => 'content_block_delta', 'index' => 0, 'delta' => ['type' => 'thinking_delta', 'thinking' => 'a product.']]],
            ['event' => 'content_block_delta', 'data' => ['type' => 'content_block_delta', 'index' => 0, 'delta' => ['type' => 'signature_delta', 'signature' => 'sig-abc']]],
            ['event' => 'content_block_stop', 'data' => ['type' => 'content_block_stop', 'index' => 0]],
            ['event' => 'content_block_start', 'data' => ['type' => 'content_block_start', 'index' => 1, 'content_block' => ['type' => 'text', 'text' => '']]],
            ['event' => 'content_block_delta', 'data' => ['type' => 'content_block_delta', 'index' => 1, 'delta' => ['type' => 'text_delta', 'text' => 'Let me look.']]],
            ['event' => 'content_block_stop', 'data' => ['type' => 'content_block_stop', 'index' => 1]],
            ['event' => 'message_delta', 'data' => ['type' => 'message_delta', 'delta' => ['stop_reason' => 'end_turn']]],
        ]))]);

        $reasoning = '';
        $text = '';
        $blocks = [];

        foreach ($this->anthropic($stack)->stream((new AiRequest([AiMessage::user('x')]))->withReasoning()) as $event) {
            match ($event->type) {
                AiStreamEvent::TYPE_REASONING => $reasoning .= (string) $event->text,
                AiStreamEvent::TYPE_TEXT => $text .= (string) $event->text,
                AiStreamEvent::TYPE_REASONING_BLOCK => $blocks[] = $event->reasoningBlock,
                default => null,
            };
        }

        // The two channels must not bleed into each other: reasoning rendered as
        // the answer is the bug this whole separation exists to prevent.
        $this->assertSame('The user wants a product.', $reasoning);
        $this->assertSame('Let me look.', $text);

        $this->assertCount(1, $blocks);
        $this->assertSame('thinking', $blocks[0]['type']);
        $this->assertSame('sig-abc', $blocks[0]['signature']);
        $this->assertSame('The user wants a product.', $blocks[0]['thinking']);
    }

    /**
     * Redacted blocks carry no readable text but still have to come back, or
     * the assistant turn is incomplete.
     */
    public function testRedactedThinkingIsCarriedWithoutBeingDisplayed(): void
    {
        $stack = $this->stack([new Response(200, [], $this->sse([
            ['event' => 'content_block_start', 'data' => ['type' => 'content_block_start', 'index' => 0, 'content_block' => ['type' => 'redacted_thinking', 'data' => 'encrypted-blob']]],
            ['event' => 'content_block_stop', 'data' => ['type' => 'content_block_stop', 'index' => 0]],
            ['event' => 'message_delta', 'data' => ['type' => 'message_delta', 'delta' => ['stop_reason' => 'end_turn']]],
        ]))]);

        $shown = '';
        $blocks = [];

        foreach ($this->anthropic($stack)->stream((new AiRequest([AiMessage::user('x')]))->withReasoning()) as $event) {
            if ($event->type === AiStreamEvent::TYPE_REASONING) {
                $shown .= (string) $event->text;
            } elseif ($event->type === AiStreamEvent::TYPE_REASONING_BLOCK) {
                $blocks[] = $event->reasoningBlock;
            }
        }

        $this->assertSame('', $shown);
        $this->assertSame([['type' => 'redacted_thinking', 'data' => 'encrypted-blob']], $blocks);
    }

    /*
    |--------------------------------------------------------------------------
    | Anthropic — the round trip
    |--------------------------------------------------------------------------
    */

    public function testThinkingIsSentBackAheadOfTheToolCallItProduced(): void
    {
        $stack = $this->stack([$this->ok()]);

        $this->anthropic($stack)->chat(new AiRequest([
            AiMessage::user('add a coupon'),
            AiMessage::assistant(
                'Let me look.',
                [new AiToolCall('tu_1', 'admin_coupons_list', [])],
                [['type' => 'thinking', 'thinking' => 'Coupons first.', 'signature' => 'sig-1']],
            ),
        ]));

        $content = $this->sentPayload()['messages'][1]['content'];

        // Order is load-bearing: the API requires thinking to lead the turn.
        $this->assertSame('thinking', $content[0]['type']);
        $this->assertSame('sig-1', $content[0]['signature']);
        $this->assertSame('text', $content[1]['type']);
        $this->assertSame('tool_use', $content[2]['type']);
    }

    /**
     * The storage is opaque and shared by every driver, so it can hold blocks
     * this API has never seen — an operator who switches provider between a
     * suspension and its resume leaves exactly that behind. A foreign or
     * unsigned block is a 400, not something the API ignores.
     */
    public function testUnsignedAndForeignBlocksAreDroppedRatherThanSent(): void
    {
        $stack = $this->stack([$this->ok()]);

        $this->anthropic($stack)->chat(new AiRequest([
            AiMessage::user('x'),
            AiMessage::assistant(null, [new AiToolCall('tu_1', 'admin_users_list', [])], [
                ['type' => 'thinking', 'thinking' => 'no signature here'],
                ['type' => 'reasoning', 'text' => 'from another provider'],
                ['type' => 'thinking', 'thinking' => '', 'signature' => 'sig-empty'],
                ['type' => 'thinking', 'thinking' => 'kept', 'signature' => 'sig-ok'],
            ]),
        ]));

        $content = $this->sentPayload()['messages'][1]['content'];
        $thinking = array_values(array_filter($content, fn ($b) => $b['type'] === 'thinking'));

        $this->assertCount(1, $thinking);
        $this->assertSame('kept', $thinking[0]['thinking']);
    }

    public function testAMessageWithoutToolCallsSendsNoThinking(): void
    {
        $stack = $this->stack([$this->ok()]);

        $this->anthropic($stack)->chat(new AiRequest([
            AiMessage::user('x'),
            AiMessage::assistant('An answer.', [], [
                ['type' => 'thinking', 'thinking' => 'thought', 'signature' => 'sig-1'],
            ]),
        ]));

        // A completed turn's thinking is stripped by the API anyway; sending it
        // would spend context on something discarded on arrival.
        $this->assertSame('An answer.', $this->sentPayload()['messages'][1]['content']);
    }

    /*
    |--------------------------------------------------------------------------
    | Surviving storage and suspension
    |--------------------------------------------------------------------------
    */

    public function testReasoningSurvivesSerialisation(): void
    {
        $blocks = [['type' => 'thinking', 'thinking' => 'because "x" > 1', 'signature' => 'sig/with+base64==']];

        $restored = AiMessage::fromArray(
            json_decode(json_encode(AiMessage::assistant('hi', [new AiToolCall('tu_1', 't', [])], $blocks)->toArray()), true)
        );

        // Byte-for-byte: the signature is verified against this exact text.
        $this->assertSame($blocks, $restored->reasoning);
    }

    /**
     * The suspension path is where this is most likely to be lost — the turn
     * stops mid-flight, goes into a JSON column, and comes back on a different
     * request. If the thinking does not come with it, resuming an approval 400s
     * on the very next model call.
     */
    public function testReasoningSurvivesAnApprovalSuspension(): void
    {
        $context = (new AgentContext(new User(), null, 'turn-uuid'))->withMessages([
            AiMessage::user('add a coupon'),
            AiMessage::assistant('Creating it.', [new AiToolCall('tu_7', 'admin_coupon_create', [])], [
                ['type' => 'thinking', 'thinking' => 'A renewal coupon needs a code.', 'signature' => 'sig-7'],
            ]),
        ]);

        $restored = AgentContext::fromState(new User(), null, 'turn-uuid', null, $context->toState());

        $this->assertSame(
            [['type' => 'thinking', 'thinking' => 'A renewal coupon needs a code.', 'signature' => 'sig-7']],
            $restored->messages[1]->reasoning,
        );
    }

    public function testMalformedStoredReasoningIsDiscardedNotPassedOn(): void
    {
        $restored = AiMessage::fromArray([
            'role' => 'assistant',
            'content' => 'x',
            'reasoning' => ['a scalar', 42, ['type' => 'thinking', 'thinking' => 'ok', 'signature' => 's']],
        ]);

        $this->assertCount(1, $restored->reasoning);
    }

    /*
    |--------------------------------------------------------------------------
    | Ollama — reasoning without a round trip
    |--------------------------------------------------------------------------
    */

    public function testOllamaRoutesItsThinkingFieldToTheReasoningChannel(): void
    {
        $ndjson = json_encode(['message' => ['role' => 'assistant', 'thinking' => 'Weighing it up.', 'content' => '']]) . "\n"
            . json_encode(['message' => ['role' => 'assistant', 'content' => 'The answer.'], 'done' => true, 'done_reason' => 'stop']) . "\n";

        $stack = $this->stack([new Response(200, [], $ndjson)]);
        $provider = new OllamaProvider(
            new ProviderConfig(
                provider: ProviderConfig::PROVIDER_OLLAMA,
                endpoint: 'http://127.0.0.1:11434/v1',
                apiKey: '',
                model: 'qwen3:30b-a3b',
                maxTokens: 512,
                temperature: 0.3,
                systemPrompt: 'test',
                contextTokens: 32768,
            ),
            $stack,
        );

        $reasoning = '';
        $text = '';

        foreach ($provider->stream((new AiRequest([AiMessage::user('x')]))->withReasoning()) as $event) {
            if ($event->type === AiStreamEvent::TYPE_REASONING) {
                $reasoning .= (string) $event->text;
            } elseif ($event->type === AiStreamEvent::TYPE_TEXT) {
                $text .= (string) $event->text;
            }
        }

        $this->assertSame('Weighing it up.', $reasoning);
        $this->assertSame('The answer.', $text);
        $this->assertTrue($this->sentPayload()['think']);
    }

    /**
     * Ollama only splits reasoning off for models whose template it knows. For
     * the rest it arrives as `<think>` tags inside ordinary content — and a tag
     * routinely straddles two deltas, because the tokeniser has no reason to
     * align with it.
     */
    public function testInlineThinkTagsAreSplitOutAcrossDeltaBoundaries(): void
    {
        $ndjson = json_encode(['message' => ['content' => '<think>I should ']]) . "\n"
            . json_encode(['message' => ['content' => 'check the list.</think>Here']]) . "\n"
            . json_encode(['message' => ['content' => ' you go.'], 'done' => true, 'done_reason' => 'stop']) . "\n";

        $stack = $this->stack([new Response(200, [], $ndjson)]);
        $provider = new OllamaProvider(
            new ProviderConfig(
                provider: ProviderConfig::PROVIDER_OLLAMA,
                endpoint: 'http://127.0.0.1:11434/v1',
                apiKey: '',
                model: 'custom-gguf',
                maxTokens: 512,
                temperature: 0.3,
                systemPrompt: 'test',
                contextTokens: 32768,
            ),
            $stack,
        );

        $reasoning = '';
        $text = '';

        foreach ($provider->stream(new AiRequest([AiMessage::user('x')])) as $event) {
            if ($event->type === AiStreamEvent::TYPE_REASONING) {
                $reasoning .= (string) $event->text;
            } elseif ($event->type === AiStreamEvent::TYPE_TEXT) {
                $text .= (string) $event->text;
            }
        }

        $this->assertSame('I should check the list.', $reasoning);
        $this->assertSame('Here you go.', $text);
    }

    /*
    |--------------------------------------------------------------------------
    | The wire vocabulary the UI reads
    |--------------------------------------------------------------------------
    */

    public function testToolResultCarriesItsPayloadAndTiming(): void
    {
        $event = AgentEvent::toolResult('tu_1', 'admin_products_list', true, '12 items', ['count' => 12], 340)->toArray();

        $this->assertSame('tool_result', $event['type']);
        $this->assertSame(['count' => 12], $event['result']);
        $this->assertSame(340, $event['duration_ms']);
    }

    /**
     * A failure has nothing worth opening, and the old two-argument shape is
     * still how a replayed row is described.
     */
    public function testToolResultOmitsAnAbsentPayload(): void
    {
        $event = AgentEvent::toolResult('tu_1', 'admin_products_list', false, 'forbidden: no')->toArray();

        $this->assertArrayNotHasKey('result', $event);
        $this->assertArrayNotHasKey('duration_ms', $event);
        // Still present, and still false — array_filter drops nulls, not falsehoods.
        $this->assertFalse($event['ok']);
    }

    public function testAPendingToolCallIsAnnouncedBeforeItsArgumentsArrive(): void
    {
        $event = AgentEvent::toolPending('tu_1', 'admin_products_list')->toArray();

        $this->assertSame('tool_pending', $event['type']);
        $this->assertSame('admin_products_list', $event['tool']);
    }

    /**
     * The stream carries a tool's name as soon as the model utters it. That
     * event has existed since the drivers were written and was dropped on the
     * floor by the runner, which is most of why a slow step looked like a hang.
     */
    public function testTheDriverAnnouncesAToolBeforeItsArgumentsAreComplete(): void
    {
        $stack = $this->stack([new Response(200, [], $this->sse([
            ['event' => 'content_block_start', 'data' => ['type' => 'content_block_start', 'index' => 0, 'content_block' => ['type' => 'tool_use', 'id' => 'tu_9', 'name' => 'admin_products_list', 'input' => []]]],
            ['event' => 'content_block_delta', 'data' => ['type' => 'content_block_delta', 'index' => 0, 'delta' => ['type' => 'input_json_delta', 'partial_json' => '{}']]],
            ['event' => 'content_block_stop', 'data' => ['type' => 'content_block_stop', 'index' => 0]],
            ['event' => 'message_delta', 'data' => ['type' => 'message_delta', 'delta' => ['stop_reason' => 'tool_use']]],
        ]))]);

        $order = [];
        foreach ($this->anthropic($stack)->stream(new AiRequest([AiMessage::user('x')], tools: [
            new AiTool('admin_products_list', 'List products', ['type' => 'object', 'properties' => []]),
        ])) as $event) {
            if (in_array($event->type, [AiStreamEvent::TYPE_TOOL_CALL_START, AiStreamEvent::TYPE_TOOL_CALL], true)) {
                $order[] = $event->type;
            }
        }

        $this->assertSame([AiStreamEvent::TYPE_TOOL_CALL_START, AiStreamEvent::TYPE_TOOL_CALL], $order);
    }
}
