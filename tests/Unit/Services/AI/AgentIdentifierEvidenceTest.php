<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Data\AiToolCall;
use Everest\Services\AI\Agent\AgentEvent;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Tools\ToolRegistry;

/** Regression for the production turn that probed product ids 101 through 115. */
class AgentIdentifierEvidenceTest extends TestCase
{
    public function testSequentialGuessedProductIdsAreNeverDispatchedAndTheSecondStopsTheTurn(): void
    {
        $user = new User();
        $user->id = 7;
        $context = new AgentContext($user, null, 'turn-product-probe');

        $context->push(AiMessage::assistant(null, [
            new AiToolCall('categories', 'admin_categories_list', []),
        ]));
        $context->push(AiMessage::tool(
            'categories',
            'admin_categories_list',
            '{"ok":true,"result":{"items":[{"id":3,"uuid":"category-uuid"}],"count":1}}',
        ));

        $definition = app(ToolRegistry::class)->find('admin_product_view')
            ?? throw new \RuntimeException('admin_product_view is not registered.');
        $runner = app(AgentRunner::class);
        $handle = new \ReflectionMethod(AgentRunner::class, 'handleCall');
        $events = [];
        $emit = static function (AgentEvent $event) use (&$events): void {
            $events[] = $event->toArray();
        };

        $first = new AiToolCall('guess-101', 'admin_product_view', [
            'category' => '3',
            'product' => '101',
        ]);
        $context->push(AiMessage::assistant(null, [$first]));

        $this->assertSame(
            'continued',
            $handle->invoke($runner, $context, $first, [$definition], $emit),
        );

        $second = new AiToolCall('guess-102', 'admin_product_view', [
            'category' => '3',
            'product' => '102',
        ]);
        $context->push(AiMessage::assistant(null, [$second]));

        $this->assertSame(
            'suspended',
            $handle->invoke($runner, $context, $second, [$definition], $emit),
        );

        $toolMessages = array_values(array_filter(
            $context->messages,
            static fn (AiMessage $message): bool => $message->role === AiMessage::ROLE_TOOL,
        ));

        $this->assertStringContainsString('unverified_identifier', (string) $toolMessages[1]->content);
        $this->assertStringContainsString('repeated_invariant_violation', (string) $toolMessages[2]->content);
        $this->assertSame('no_progress', $this->doneReason($events));
        $this->assertFalse($this->hasEvent($events, 'tool_call'));
    }

    /** @param array<int, array<string, mixed>> $events */
    private function doneReason(array $events): ?string
    {
        foreach ($events as $event) {
            if (($event['type'] ?? null) === 'done') {
                return isset($event['reason']) ? (string) $event['reason'] : null;
            }
        }

        return null;
    }

    /** @param array<int, array<string, mixed>> $events */
    private function hasEvent(array $events, string $type): bool
    {
        foreach ($events as $event) {
            if (($event['type'] ?? null) === $type) {
                return true;
            }
        }

        return false;
    }
}
