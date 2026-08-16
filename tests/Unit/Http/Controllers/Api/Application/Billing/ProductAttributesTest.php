<?php

namespace Everest\Tests\Unit\Http\Controllers\Api\Application\Billing;

use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Everest\Http\Controllers\Api\Application\Billing\ProductController;

/**
 * Covers the attribute derivation behind product create/update.
 *
 * These pin three behaviours that were previously broken:
 *   • `visible` was never written at all, so the admin toggle was a no-op;
 *   • limits are validated as flat `*_limit` keys but sent nested under
 *     `limits`, so both shapes have to be accepted.
 *
 * attributesFrom() is private, so it's exercised by reflection — the logic is a
 * pure function of the request and is worth pinning directly rather than behind
 * a full findOrFail + Activity-log round trip.
 */
class ProductAttributesTest extends TestCase
{
    public function tearDown(): void
    {
        \Mockery::close();
        parent::tearDown();
    }

    private function attributes(array $payload, ?bool $visibleDefault = true): array
    {
        $controller = $this->app->make(ProductController::class);

        $method = new \ReflectionMethod($controller, 'attributesFrom');
        $method->setAccessible(true);

        return $method->invoke($controller, new Request($payload), $visibleDefault);
    }

    private function basePayload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Example',
            'price' => 5.0,
            'limits' => [
                'cpu' => 100,
                'memory' => 1024,
                'disk' => 4096,
                'backup' => 1,
                'database' => 1,
                'allocation' => 1,
                'subdomain' => 1,
            ],
        ], $overrides);
    }

    public function testVisibleFalseIsPersisted(): void
    {
        $attributes = $this->attributes($this->basePayload(['visible' => false]));

        $this->assertArrayHasKey('visible', $attributes);
        $this->assertFalse($attributes['visible']);
    }

    public function testVisibleDefaultsToTrueOnCreate(): void
    {
        $attributes = $this->attributes($this->basePayload());

        $this->assertTrue($attributes['visible']);
    }

    public function testVisibleIsOmittedOnUpdateWhenAbsent(): void
    {
        // A null default means "leave whatever is stored alone" — omitting the
        // key must not silently flip a hidden plan back on sale.
        $attributes = $this->attributes($this->basePayload(), null);

        $this->assertArrayNotHasKey('visible', $attributes);
    }

    public function testAnUpdateContainsOnlyFieldsThatWerePresent(): void
    {
        $this->assertSame(['name' => 'Renamed'], $this->attributes([
            'name' => 'Renamed',
        ], null));
    }

    public function testUpdatePreservesExplicitNullAndZero(): void
    {
        $attributes = $this->attributes([
            'description' => null,
            'price' => 0,
            'subdomain_limit' => null,
            'backup_limit' => 0,
        ], null);

        $this->assertSame([
            'description' => null,
            'price' => 0.0,
            'backup_limit' => 0,
            'subdomain_limit' => null,
        ], $attributes);
    }

    /**
     * Products now carry a single price. base_price was collapsed into it
     * (2026_07_21_000001) because the two columns disagreed about which one
     * customers were actually billed from, so nothing should write it back.
     */
    public function testBasePriceIsNeverWritten(): void
    {
        $attributes = $this->attributes($this->basePayload(['base_price' => 8.0]));

        $this->assertArrayNotHasKey('base_price', $attributes);
        $this->assertSame(5.0, $attributes['price']);
    }

    public function testLimitsAreReadFromFlatKeysWhenNotNested(): void
    {
        $attributes = $this->attributes([
            'name' => 'Example',
            'price' => 5.0,
            'cpu_limit' => 200,
            'memory_limit' => 2048,
            'disk_limit' => 8192,
            'backup_limit' => 2,
            'database_limit' => 3,
            'allocation_limit' => 4,
            'subdomain_limit' => 5,
        ]);

        $this->assertSame(200, $attributes['cpu_limit']);
        $this->assertSame(2048, $attributes['memory_limit']);
        $this->assertSame(8192, $attributes['disk_limit']);
        $this->assertSame(2, $attributes['backup_limit']);
        $this->assertSame(3, $attributes['database_limit']);
        $this->assertSame(4, $attributes['allocation_limit']);
        $this->assertSame(5, $attributes['subdomain_limit']);
    }

    public function testNestedLimitsWin(): void
    {
        $attributes = $this->attributes($this->basePayload(['cpu_limit' => 999]));

        $this->assertSame(100, $attributes['cpu_limit']);
    }

    public function testSubdomainLimitDefaultsToOne(): void
    {
        $attributes = $this->attributes([
            'name' => 'Example',
            'price' => 5.0,
        ]);

        $this->assertSame(1, $attributes['subdomain_limit']);
        $this->assertSame(0, $attributes['cpu_limit']);
    }
}
