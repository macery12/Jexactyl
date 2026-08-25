<?php

namespace Everest\Services\AI\Agent;

use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Tools\ToolResult;
use Everest\Services\AI\Tools\ToolDefinition;

/**
 * Prevent model-supplied catalogue identifiers from becoming lookup probes.
 *
 * Admin identifiers cannot be route-bound like a customer server UUID because
 * an administrator legitimately works across the whole panel. They still need
 * provenance: a category must come from the category listing, and a product
 * must come from the product listing for that same category. Prompt wording is
 * useful guidance, but it cannot be the control for a model that increments a
 * guessed id after every 404.
 */
class IdentifierEvidenceGuard
{
    private const CATEGORIES_LIST = 'admin_categories_list';
    private const PRODUCTS_LIST = 'admin_products_list';

    /**
     * Return a refusal when a catalogue call uses an identifier that current
     * turn evidence did not establish.
     *
     * @param array<string, mixed> $arguments
     */
    public function validate(
        AgentContext $context,
        ToolDefinition $definition,
        array $arguments,
    ): ?ToolResult {
        return match ($definition->name) {
            self::PRODUCTS_LIST => $this->categoryRefusal($context, $arguments),
            'admin_product_view',
            'admin_cycles_list' => $this->productRefusal($context, $arguments),
            'admin_product_update' => $this->productUpdateRefusal($context, $arguments),
            'admin_product_create' => $this->productCreateRefusal($context, $arguments),
            default => null,
        };
    }

    /** @param array<string, mixed> $arguments */
    private function categoryRefusal(AgentContext $context, array $arguments): ?ToolResult
    {
        $category = (string) ($arguments['category'] ?? '');

        if ($category !== '' && $this->category($context, $category) !== null) {
            return null;
        }

        return ToolResult::error(
            code: 'unverified_identifier',
            detail: sprintf(
                'Category id "%s" was not returned by admin_categories_list in this turn. The call was not sent.',
                $category,
            ),
            requires: [[
                'action' => 'list_categories',
                'tool' => self::CATEGORIES_LIST,
            ]],
            next: 'Call admin_categories_list once, inspect its result, and use only an exact id from its items. Never probe sequential category ids.',
        );
    }

    /** @param array<string, mixed> $arguments */
    private function productRefusal(AgentContext $context, array $arguments): ?ToolResult
    {
        if (($categoryRefusal = $this->categoryRefusal($context, $arguments)) !== null) {
            return $categoryRefusal;
        }

        $category = (string) ($arguments['category'] ?? '');
        $product = (string) ($arguments['product'] ?? '');

        if ($product !== '' && $this->product($context, $category, $product) !== null) {
            return null;
        }

        return ToolResult::error(
            code: 'unverified_identifier',
            detail: sprintf(
                'Product id "%s" was not returned by admin_products_list for category "%s" in this turn. The call was not sent.',
                $product,
                $category,
            ),
            requires: [[
                'action' => 'list_products',
                'tool' => self::PRODUCTS_LIST,
                'arguments' => ['category' => $category],
            ]],
            next: 'Call admin_products_list once for this verified category and use only an exact product id from its items. If it returns no products, do not guess or probe ids; ask the user for the missing new-product details.',
        );
    }

    /** @param array<string, mixed> $arguments */
    private function productCreateRefusal(AgentContext $context, array $arguments): ?ToolResult
    {
        if (($categoryRefusal = $this->categoryRefusal($context, $arguments)) !== null) {
            return $categoryRefusal;
        }

        $category = (string) ($arguments['category'] ?? '');
        $suppliedUuid = (string) ($arguments['category_uuid'] ?? '');
        $categoryItem = $this->category($context, $category);

        if ($suppliedUuid === '' || (string) ($categoryItem['uuid'] ?? '') !== $suppliedUuid) {
            return ToolResult::error(
                code: 'unverified_identifier',
                detail: 'The category id and uuid pair was not returned together by '
                    . 'admin_categories_list. Product creation was not sent.',
                requires: [[
                    'action' => 'list_categories',
                    'tool' => self::CATEGORIES_LIST,
                ]],
                next: 'Call admin_categories_list once and copy both id and uuid from the same returned category item.',
            );
        }

        $products = $this->productItems($context, $category);

        if ($products === null) {
            return ToolResult::error(
                code: 'missing_evidence',
                detail: sprintf(
                    'Products in category "%s" have not been listed in this turn. Product creation was not sent.',
                    $category,
                ),
                requires: [[
                    'action' => 'list_products',
                    'tool' => self::PRODUCTS_LIST,
                    'arguments' => ['category' => $category],
                ]],
                next: 'Call admin_products_list once. If it has an item, read that exact product before choosing resource limits. If it is empty, ask the user for the missing name and resource limits; never probe product ids.',
            );
        }

        $productIds = array_values(array_filter(
            array_map(static fn (array $item): string => (string) ($item['id'] ?? ''), $products),
            static fn (string $id): bool => $id !== '',
        ));

        if ($products === [] || ($productIds !== [] && $this->hasProductView(
            $context,
            $category,
            $productIds,
        ))) {
            return null;
        }

        return ToolResult::error(
            code: 'missing_evidence',
            detail: 'An existing product in this category has not been read in this turn. '
                . 'Product creation was not sent because its resource limits have no verified template.',
            requires: [[
                'action' => 'read_product_template',
                'tool' => 'admin_product_view',
                'arguments' => ['category' => $category],
            ]],
            next: 'Read one exact product id returned by admin_products_list and use its verified resource-limit shape. Do not guess an id or invent limits.',
        );
    }

    /** @param array<string, mixed> $arguments */
    private function productUpdateRefusal(AgentContext $context, array $arguments): ?ToolResult
    {
        if (($productRefusal = $this->productRefusal($context, $arguments)) !== null) {
            return $productRefusal;
        }

        $category = (string) ($arguments['category'] ?? '');
        $product = (string) ($arguments['product'] ?? '');

        if ($this->hasProductView($context, $category, [$product])) {
            return null;
        }

        return ToolResult::error(
            code: 'missing_evidence',
            detail: sprintf(
                'Product "%s" has not been read in category "%s" during this turn. The update was not sent.',
                $product,
                $category,
            ),
            requires: [[
                'action' => 'read_product',
                'tool' => 'admin_product_view',
                'arguments' => ['category' => $category, 'product' => $product],
            ]],
            next: 'Read this exact listed product first, then send only the fields that should change.',
        );
    }

    /** @return array<string, mixed>|null */
    private function category(AgentContext $context, string $id): ?array
    {
        foreach (array_reverse($this->results($context, self::CATEGORIES_LIST)) as $result) {
            foreach ($this->items($result['payload']) as $item) {
                if ($id !== '' && (string) ($item['id'] ?? '') === $id) {
                    return $item;
                }
            }
        }

        return null;
    }

    /** @return array<string, mixed>|null */
    private function product(AgentContext $context, string $category, string $id): ?array
    {
        foreach ($this->productItems($context, $category) ?? [] as $item) {
            if ($id !== '' && (string) ($item['id'] ?? '') === $id) {
                return $item;
            }
        }

        return null;
    }

    /** @return array<int, array<string, mixed>>|null */
    private function productItems(AgentContext $context, string $category): ?array
    {
        foreach (array_reverse($this->results($context, self::PRODUCTS_LIST)) as $result) {
            if ((string) ($result['arguments']['category'] ?? '') === $category) {
                return $this->items($result['payload']);
            }
        }

        return null;
    }

    /** @param string[] $productIds */
    private function hasProductView(
        AgentContext $context,
        string $category,
        array $productIds,
    ): bool {
        foreach (array_reverse($this->results($context, 'admin_product_view')) as $result) {
            if (
                (string) ($result['arguments']['category'] ?? '') === $category
                && in_array((string) ($result['arguments']['product'] ?? ''), $productIds, true)
            ) {
                return true;
            }
        }

        return false;
    }

    /**
     * Successful result payloads paired with the arguments of the call that
     * produced them. Stored display summaries deliberately do not count as
     * evidence; a later turn must re-list mutable catalogue state.
     *
     * @return array<int, array{arguments: array<string, mixed>, payload: array<string, mixed>}>
     */
    private function results(AgentContext $context, string $tool): array
    {
        $calls = [];

        foreach ($context->messages as $message) {
            if ($message->role !== AiMessage::ROLE_ASSISTANT) {
                continue;
            }

            foreach ($message->toolCalls as $call) {
                $calls[$call->id] = [
                    'tool' => $call->name,
                    'arguments' => $call->arguments,
                ];
            }
        }

        $results = [];

        foreach ($context->messages as $message) {
            if (
                $message->role !== AiMessage::ROLE_TOOL
                || $message->toolName !== $tool
                || $message->isError
                || $message->toolCallId === null
            ) {
                continue;
            }

            $call = $calls[$message->toolCallId] ?? null;
            $payload = json_decode((string) $message->content, true);

            if (
                $call === null
                || $call['tool'] !== $tool
                || !is_array($payload)
                || ($payload['ok'] ?? false) !== true
                || !is_array($payload['result'] ?? null)
            ) {
                continue;
            }

            $results[] = [
                'arguments' => $call['arguments'],
                'payload' => $payload['result'],
            ];
        }

        return $results;
    }

    /** @return array<int, array<string, mixed>> */
    private function items(array $payload): array
    {
        return array_values(array_filter(
            is_array($payload['items'] ?? null) ? $payload['items'] : [],
            'is_array',
        ));
    }
}
