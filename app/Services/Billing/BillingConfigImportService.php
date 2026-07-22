<?php

namespace Everest\Services\Billing;

use Everest\Models\Egg;
use Everest\Models\Nest;
use Illuminate\Support\Str;
use Everest\Models\Billing\Product;
use Everest\Models\Billing\Category;
use Everest\Models\Billing\BillingCycle;

class BillingConfigImportService
{
    /**
     * Analyze an import payload and apply one-time conflict resolutions.
     */
    public function analyze(array $import_data, bool $ignore_duplicates, array $resolution = []): array
    {
        $categories = array_values(array_filter($import_data['categories'] ?? [], 'is_array'));
        $products = array_values(array_filter($import_data['products'] ?? [], 'is_array'));
        $resolutionMap = $resolution['categories'] ?? [];

        $categories = $this->filterDroppedCategories($categories, $resolutionMap);
        $products = $this->filterDroppedCategoryProducts($products, $categories, $resolutionMap);

        foreach ($categories as $index => $category) {
            if ($ignore_duplicates && isset($category['name']) && Category::where('name', $category['name'])->exists()) {
                continue;
            }

            $categoryKey = $this->getCategoryKey($category, $index);
            $categoryResolution = is_array($resolutionMap[$categoryKey] ?? null) ? $resolutionMap[$categoryKey] : [];

            if (array_key_exists('nest_id', $categoryResolution)) {
                $category['nest_id'] = (int) $categoryResolution['nest_id'];
            }

            if (array_key_exists('egg_id', $categoryResolution)) {
                $category['egg_id'] = (int) $categoryResolution['egg_id'];
            }

            if (array_key_exists('allowed_eggs', $categoryResolution) && is_array($categoryResolution['allowed_eggs'])) {
                $category['allowed_eggs'] = array_values(array_map('intval', $categoryResolution['allowed_eggs']));
            }

            $categories[$index] = $category;
        }

        $products = $this->filterDroppedProducts($products, $categories, $resolutionMap);

        $conflicts = [];
        foreach ($categories as $index => $category) {
            if ($ignore_duplicates && isset($category['name']) && Category::where('name', $category['name'])->exists()) {
                continue;
            }

            $conflict = $this->buildCategoryConflict($category, $products, $this->getCategoryKey($category, $index));
            if (!is_null($conflict)) {
                $conflicts[] = $conflict;
            }
        }

        return [
            'data' => [
                'categories' => $categories,
                'products' => $products,
            ],
            'conflicts' => $conflicts,
            'available_nests' => Nest::query()
                ->select(['id', 'name'])
                ->orderBy('name')
                ->get()
                ->toArray(),
        ];
    }

    /**
     * Process a formatted JSON configuration file.
     */
    public function persist(array $import_data, bool $ignore_duplicates): void
    {
        $old_data = [];

        // Create new categories and map old category UUIDs to new ones
        foreach ($import_data['categories'] as $category) {
            // Skip existing categories if ignore_duplicates is true and a category with the same name exists
            if ($ignore_duplicates && Category::where('name', $category['name'])->exists()) {
                $existingCategory = Category::where('name', $category['name'])->first();
                if (!empty($category['uuid']) && $existingCategory instanceof Category) {
                    $old_data[$category['uuid']] = $existingCategory->uuid;
                }

                continue;  // Skip this category if it already exists
            }
            $new_uuid = Str::uuid()->toString();

            // Create the new category
            $new_category = Category::create([
                'uuid' => $new_uuid, // don't overlap UUIDs
                'name' => $category['name'],
                'icon' => $category['icon'] ?? null,
                'description' => $category['description'],
                'visible' => (bool) $category['visible'],
                'egg_id' => (int) $category['egg_id'],
                'nest_id' => (int) $category['nest_id'],
                'allowed_eggs' => $category['allowed_eggs'] ?? null,
                'allow_egg_changes' => isset($category['allow_egg_changes']) ? (bool) $category['allow_egg_changes'] : true,
                'allow_plan_changes' => isset($category['allow_plan_changes']) ? (bool) $category['allow_plan_changes'] : true,
            ]);

            // Map the old category UUID to the new category UUID
            $old_data[$category['uuid']] = $new_category->uuid;

        }

        // Create products and assign them to the correct new category
        foreach ($import_data['products'] as $product) {
            // Skip existing products if ignore_duplicates is true and a product with the same name exists in the same category
            if ($ignore_duplicates && Product::where('name', $product['name'])
                                            ->where('category_uuid', $old_data[$product['category_uuid']] ?? null)
                                            ->exists()) {
                continue;  // Skip this product if it already exists in the same category
            }
            $category_id = null;
            $new_uuid = Str::uuid()->toString();

            // Check if the product's old category UUID exists in the mapping
            if (array_key_exists($product['category_uuid'], $old_data)) {
                // Assign the new category UUID based on the old category UUID mapping
                $category_id = $old_data[$product['category_uuid']];
            }

            // If no valid category_id was assigned, throw an error
            if (!$category_id) {
                throw new \RuntimeException("Import failed: product '{$product['name']}' references unknown category UUID '{$product['category_uuid']}'. " . 'Ensure the category is included in the import data.');
            }

            // Create the product with the new category_id
            $new_product = Product::create([
                'uuid' => $new_uuid, // don't overlap UUIDs
                'name' => $product['name'],
                'icon' => $product['icon'] ?? null,
                'price' => (float) $product['price'],
                'description' => $product['description'],
                'visible' => (bool) $product['visible'],
                'cpu_limit' => (int) $product['cpu_limit'],
                'memory_limit' => (int) $product['memory_limit'],
                'disk_limit' => (int) $product['disk_limit'],
                'backup_limit' => (int) $product['backup_limit'],
                'database_limit' => (int) $product['database_limit'],
                'allocation_limit' => (int) $product['allocation_limit'],
                'subdomain_limit' => array_key_exists('subdomain_limit', $product) ? (is_null($product['subdomain_limit']) ? null : (int) $product['subdomain_limit']) : null,
                'category_uuid' => $category_id, // Correctly assign the new category ID
                'stripe_id' => null, // deprecated
            ]);

            // Import billing cycles if present — backwards compatible: older exports
            // from other software may not include this key, so we silently skip it.
            if (!empty($product['billing_cycles'])) {
                foreach ($product['billing_cycles'] as $cycle) {
                    BillingCycle::create([
                        'product_id' => $new_product->id,
                        'days' => (int) $cycle['days'],
                        'is_enabled' => (bool) ($cycle['is_enabled'] ?? true),
                    ]);
                }
            }

        }
    }

    /**
     * Build a stable category key for conflict mapping between frontend and backend.
     */
    private function getCategoryKey(array $category, int $index): string
    {
        if (!empty($category['uuid']) && is_string($category['uuid'])) {
            return $category['uuid'];
        }

        return '__index_' . $index;
    }

    /**
     * Remove products explicitly dropped during conflict resolution.
     */
    private function filterDroppedProducts(array $products, array $categories, array $resolutionMap): array
    {
        $categoryLookup = [];
        foreach ($categories as $index => $category) {
            if (!is_array($category)) {
                continue;
            }

            $key = $this->getCategoryKey($category, $index);
            $categoryLookup[$key] = $category;
        }

        return array_values(array_filter($products, function (array $product) use ($categoryLookup, $resolutionMap) {
            $categoryUuid = (string) ($product['category_uuid'] ?? '');
            if ($categoryUuid === '' || !isset($categoryLookup[$categoryUuid])) {
                return true;
            }

            $dropProducts = $resolutionMap[$categoryUuid]['drop_products'] ?? [];
            if (!is_array($dropProducts) || empty($dropProducts)) {
                return true;
            }

            $productUuid = (string) ($product['uuid'] ?? '');
            $productName = (string) ($product['name'] ?? '');

            return !in_array($productUuid, $dropProducts, true) && !in_array($productName, $dropProducts, true);
        }));
    }

    /**
     * Remove categories explicitly dropped during conflict resolution.
     */
    private function filterDroppedCategories(array $categories, array $resolutionMap): array
    {
        return array_values(array_filter($categories, function (array $category, int $index) use ($resolutionMap) {
            $categoryKey = $this->getCategoryKey($category, $index);
            $dropCategory = (bool) ($resolutionMap[$categoryKey]['drop_category'] ?? false);

            return !$dropCategory;
        }, ARRAY_FILTER_USE_BOTH));
    }

    /**
     * Remove products that belong to categories dropped during conflict resolution.
     */
    private function filterDroppedCategoryProducts(array $products, array $categories, array $resolutionMap): array
    {
        $categoryLookup = [];
        foreach ($categories as $index => $category) {
            if (!is_array($category)) {
                continue;
            }

            $categoryKey = $this->getCategoryKey($category, $index);
            $categoryLookup[$categoryKey] = $category;
        }

        return array_values(array_filter($products, function (array $product) use ($resolutionMap) {
            $categoryUuid = (string) ($product['category_uuid'] ?? '');
            if ($categoryUuid === '' || !isset($resolutionMap[$categoryUuid])) {
                return true;
            }

            $dropCategory = (bool) ($resolutionMap[$categoryUuid]['drop_category'] ?? false);

            return !$dropCategory;
        }));
    }

    /**
     * Return conflict details if imported category nest/egg references are invalid.
     */
    private function buildCategoryConflict(array $category, array $products, string $categoryKey): ?array
    {
        $nestId = isset($category['nest_id']) ? (int) $category['nest_id'] : null;
        $eggId = isset($category['egg_id']) ? (int) $category['egg_id'] : null;
        $allowedEggs = is_array($category['allowed_eggs'] ?? null)
            ? array_values(array_map('intval', $category['allowed_eggs']))
            : [];

        $issues = [];
        $nest = is_null($nestId) ? null : Nest::query()->find($nestId);
        if (!$nest) {
            $issues[] = [
                'field' => 'nest_id',
                'code' => 'invalid_nest',
                'invalid_value' => $nestId,
                'message' => 'The selected nest id is invalid.',
            ];
        }

        if (!is_null($eggId)) {
            $defaultEgg = Egg::query()->find($eggId);
            if (!$defaultEgg || (!$nest ? false : $defaultEgg->nest_id !== $nest->id)) {
                $issues[] = [
                    'field' => 'egg_id',
                    'code' => 'invalid_default_egg',
                    'invalid_value' => $eggId,
                    'message' => 'The selected egg id is invalid for the selected nest.',
                ];
            }
        }

        if (!empty($allowedEggs)) {
            $invalidAllowedEggs = [];
            foreach ($allowedEggs as $allowedEggId) {
                $egg = Egg::query()->find($allowedEggId);
                if (!$egg || (!$nest ? false : $egg->nest_id !== $nest->id)) {
                    $invalidAllowedEggs[] = $allowedEggId;
                }
            }

            if (!empty($invalidAllowedEggs)) {
                $issues[] = [
                    'field' => 'allowed_eggs',
                    'code' => 'invalid_allowed_eggs',
                    'invalid_values' => $invalidAllowedEggs,
                    'message' => 'One or more allowed eggs are invalid for the selected nest.',
                ];
            }
        }

        if (empty($issues)) {
            return null;
        }

        $dependentProducts = [];
        foreach ($products as $product) {
            if (($product['category_uuid'] ?? null) !== ($category['uuid'] ?? null)) {
                continue;
            }

            $dependentProducts[] = [
                'uuid' => (string) ($product['uuid'] ?? ''),
                'name' => (string) ($product['name'] ?? 'Unnamed product'),
            ];
        }

        return [
            'category_key' => $categoryKey,
            'category_uuid' => (string) ($category['uuid'] ?? ''),
            'category_name' => (string) ($category['name'] ?? 'Unnamed category'),
            'current' => [
                'nest_id' => $nestId,
                'egg_id' => $eggId,
                'allowed_eggs' => $allowedEggs,
            ],
            'issues' => $issues,
            'dependent_products' => $dependentProducts,
        ];
    }
}
