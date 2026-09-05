<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Data\AiToolCall;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Agent\IdentifierEvidenceGuard;

class IdentifierEvidenceGuardTest extends TestCase
{
    private int $call = 0;

    public function testProductIdsMustComeFromTheMatchingProductList(): void
    {
        $context = $this->context();
        $guard = app(IdentifierEvidenceGuard::class);

        $this->success($context, 'admin_categories_list', [], [
            'items' => [['id' => 3, 'uuid' => 'category-uuid', 'name' => 'Minecraft']],
            'count' => 1,
        ]);

        $view = $this->definition('admin_product_view');
        $unverified = $guard->validate($context, $view, ['category' => '3', 'product' => '101']);

        $this->assertSame('unverified_identifier', $unverified?->code);
        $this->assertSame('admin_products_list', $unverified?->requires[0]['tool'] ?? null);

        $this->success($context, 'admin_products_list', ['category' => '3'], [
            'items' => [['id' => 17, 'uuid' => 'product-uuid', 'name' => 'Starter']],
            'count' => 1,
        ]);

        $this->assertNull($guard->validate($context, $view, ['category' => '3', 'product' => '17']));
        $this->assertSame(
            'unverified_identifier',
            $guard->validate($context, $view, ['category' => '3', 'product' => '18'])?->code,
        );
    }

    public function testAProductFromAnotherCategoryIsNotEvidence(): void
    {
        $context = $this->context();
        $guard = app(IdentifierEvidenceGuard::class);

        $this->success($context, 'admin_categories_list', [], [
            'items' => [
                ['id' => 3, 'uuid' => 'category-3'],
                ['id' => 4, 'uuid' => 'category-4'],
            ],
            'count' => 2,
        ]);
        $this->success($context, 'admin_products_list', ['category' => '4'], [
            'items' => [['id' => 17, 'name' => 'Other category']],
            'count' => 1,
        ]);

        $result = $guard->validate(
            $context,
            $this->definition('admin_product_view'),
            ['category' => '3', 'product' => '17'],
        );

        $this->assertSame('unverified_identifier', $result?->code);
    }

    public function testProductCreationRequiresTheExactCategoryPairAndAProductListing(): void
    {
        $context = $this->context();
        $guard = app(IdentifierEvidenceGuard::class);
        $create = $this->definition('admin_product_create');

        $this->success($context, 'admin_categories_list', [], [
            'items' => [['id' => 3, 'uuid' => 'category-uuid']],
            'count' => 1,
        ]);

        $this->assertSame(
            'unverified_identifier',
            $guard->validate($context, $create, [
                'category' => '3',
                'category_uuid' => 'invented-uuid',
            ])?->code,
        );
        $this->assertSame(
            'missing_evidence',
            $guard->validate($context, $create, [
                'category' => '3',
                'category_uuid' => 'category-uuid',
            ])?->code,
        );

        $this->success($context, 'admin_products_list', ['category' => '3'], [
            'items' => [],
            'count' => 0,
        ]);

        $this->assertNull($guard->validate($context, $create, [
            'category' => '3',
            'category_uuid' => 'category-uuid',
        ]));
    }

    public function testExistingProductMustBeReadBeforeCreatingFromItsResourceShape(): void
    {
        $context = $this->context();
        $guard = app(IdentifierEvidenceGuard::class);
        $create = $this->definition('admin_product_create');
        $arguments = ['category' => '3', 'category_uuid' => 'category-uuid'];

        $this->success($context, 'admin_categories_list', [], [
            'items' => [['id' => 3, 'uuid' => 'category-uuid']],
            'count' => 1,
        ]);
        $this->success($context, 'admin_products_list', ['category' => '3'], [
            'items' => [['id' => 17, 'name' => 'Starter']],
            'count' => 1,
        ]);

        $this->assertSame('missing_evidence', $guard->validate($context, $create, $arguments)?->code);

        $this->success($context, 'admin_product_view', ['category' => '3', 'product' => '17'], [
            'id' => 17,
            'cpu_limit' => 100,
            'memory_limit' => 1024,
        ]);

        $this->assertNull($guard->validate($context, $create, $arguments));
    }

    public function testProductUpdateRequiresAReadOfTheExactListedProduct(): void
    {
        $context = $this->context();
        $guard = app(IdentifierEvidenceGuard::class);
        $update = $this->definition('admin_product_update');
        $arguments = ['category' => '3', 'product' => '17', 'price' => 10];

        $this->success($context, 'admin_categories_list', [], [
            'items' => [['id' => 3, 'uuid' => 'category-uuid']],
            'count' => 1,
        ]);
        $this->success($context, 'admin_products_list', ['category' => '3'], [
            'items' => [['id' => 17, 'name' => 'Starter']],
            'count' => 1,
        ]);

        $this->assertSame('missing_evidence', $guard->validate($context, $update, $arguments)?->code);

        $this->success($context, 'admin_product_view', ['category' => '3', 'product' => '17'], [
            'id' => 17,
            'price' => 5,
        ]);

        $this->assertNull($guard->validate($context, $update, $arguments));
    }

    public function testStoredDisplaySummariesDoNotBecomeIdentifierEvidence(): void
    {
        $context = $this->context();
        $this->toolExchange(
            $context,
            'admin_categories_list',
            [],
            ['ok' => true, 'outcome' => 'success', 'summary' => '1 item'],
        );

        $result = app(IdentifierEvidenceGuard::class)->validate(
            $context,
            $this->definition('admin_products_list'),
            ['category' => '3'],
        );

        $this->assertSame('unverified_identifier', $result?->code);
    }

    private function context(): AgentContext
    {
        $user = new User();
        $user->id = 7;

        return new AgentContext($user, null, 'turn-identifier-evidence');
    }

    private function definition(string $name): ToolDefinition
    {
        return app(ToolRegistry::class)->find($name)
            ?? throw new \RuntimeException(sprintf('Missing tool definition: %s', $name));
    }

    /** @param array<string, mixed> $arguments */
    private function success(
        AgentContext $context,
        string $tool,
        array $arguments,
        array $result,
    ): void {
        $this->toolExchange($context, $tool, $arguments, ['ok' => true, 'result' => $result]);
    }

    /**
     * @param array<string, mixed> $arguments
     * @param array<string, mixed> $payload
     */
    private function toolExchange(
        AgentContext $context,
        string $tool,
        array $arguments,
        array $payload,
    ): void {
        $id = 'call-' . ++$this->call;

        $context->push(AiMessage::assistant(null, [
            new AiToolCall($id, $tool, $arguments),
        ]));
        $context->push(AiMessage::tool(
            $id,
            $tool,
            (string) json_encode($payload),
        ));
    }
}
