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
        $this->assertNotContains(AdminRole::LOCATIONS_UPDATE, $registry->all());
        $this->assertNotContains(AdminRole::MOUNTS_READ, $registry->all());
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

    public function testKnownLegacyModuleCapabilitiesNormalizeWithoutInventingAuthority(): void
    {
        $registry = new AdminCapabilityRegistry();

        $this->assertSame([
            AdminRole::MODS_READ,
            AdminRole::MODS_UPDATE,
            AdminRole::EXTENSIONS_READ,
            AdminRole::EXTENSIONS_REPOSITORIES,
            AdminRole::EXTENSIONS_INSTALL,
            'marketplace.install',
            'marketplace.delete',
        ], $registry->normalizeMany([
            'marketplace.read',
            'marketplace.update',
            'repositories.read',
            'repositories.create',
            'extensions.create',
            'marketplace.install',
            'marketplace.delete',
        ]));

        $this->assertSame([
            AdminRole::MODS_READ,
            AdminRole::MODS_UPDATE,
            AdminRole::EXTENSIONS_READ,
            AdminRole::EXTENSIONS_REPOSITORIES,
            AdminRole::EXTENSIONS_INSTALL,
        ], $registry->valid([
            'marketplace.read',
            'marketplace.update',
            'repositories.read',
            'repositories.create',
            'extensions.create',
            'marketplace.install',
            'marketplace.delete',
        ]));
    }

    public function testLegacyNestedAccessExpandsToEveryReplacementCapability(): void
    {
        $registry = new AdminCapabilityRegistry();

        $expanded = $registry->expandLegacyProfile([
            AdminRole::NODES_READ,
            AdminRole::NODES_UPDATE,
            AdminRole::NODES_DELETE,
            AdminRole::SERVERS_READ,
            AdminRole::SERVERS_UPDATE,
            AdminRole::DATABASES_READ,
        ]);

        foreach ([
            AdminRole::ALLOCATIONS_READ,
            AdminRole::ALLOCATIONS_CREATE,
            AdminRole::ALLOCATIONS_DELETE,
            AdminRole::SERVER_DATABASES_READ,
            AdminRole::SERVER_DATABASES_CREATE,
            AdminRole::SERVER_DATABASES_UPDATE,
            AdminRole::SERVER_DATABASES_DELETE,
        ] as $capability) {
            $this->assertContains($capability, $expanded);
        }
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
