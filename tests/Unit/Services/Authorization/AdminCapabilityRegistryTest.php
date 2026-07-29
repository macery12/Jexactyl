<?php

namespace Everest\Tests\Unit\Services\Authorization;

use Everest\Tests\TestCase;
use Everest\Models\AdminRole;
use Everest\Services\Authorization\AdminCapabilityRegistry;

class AdminCapabilityRegistryTest extends TestCase
{
    public function testCatalogFlattensToCanonicalCapabilities(): void
    {
        $registry = new AdminCapabilityRegistry();

        $this->assertContains(AdminRole::BILLING_PRODUCTS_CREATE, $registry->all());
        $this->assertContains(AdminRole::BILLING_CATEGORIES_UPDATE, $registry->all());
        $this->assertContains(AdminRole::ALLOCATIONS_READ, $registry->all());
        $this->assertContains(AdminRole::SERVER_DATABASES_DELETE, $registry->all());
        $this->assertContains(AdminRole::LOCATIONS_UPDATE, $registry->all());
    }

    public function testLegacyBillingCapabilitiesNormalizeWithoutBroadening(): void
    {
        $registry = new AdminCapabilityRegistry();

        $this->assertSame([
            AdminRole::BILLING_PRODUCTS_CREATE,
            AdminRole::BILLING_CATEGORIES_DELETE,
        ], $registry->normalizeMany([
            'billing.product-create',
            'billing.category-delete',
            'billing.product-create',
        ]));
    }

    public function testUnknownCapabilitiesFailRegistryValidation(): void
    {
        $registry = new AdminCapabilityRegistry();

        $this->assertFalse($registry->isValid('billing.not-real'));
        $this->assertSame(['billing.not-real'], $registry->invalid(['billing.not-real']));
    }

    public function testOnlyCustomEligibleProfilesCanBackApiKeys(): void
    {
        $registry = new AdminCapabilityRegistry();

        $owner = new AdminRole();
        $owner->forceFill([
            'is_owner' => true,
            'api_eligible' => false,
        ]);
        $custom = new AdminRole();
        $custom->forceFill([
            'is_owner' => false,
            'api_eligible' => true,
        ]);

        $this->assertFalse($registry->isApiEligible($owner));
        $this->assertTrue($registry->isApiEligible($custom));
    }
}
