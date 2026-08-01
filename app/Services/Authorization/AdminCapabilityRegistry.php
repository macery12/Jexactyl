<?php

namespace Everest\Services\Authorization;

use Everest\Models\AdminRole;

/**
 * Canonical registry for Access Profile capabilities.
 *
 * AdminRole::permissions() remains the human-facing catalog and this class is
 * the only place that flattens it into stable capability identifiers.
 */
class AdminCapabilityRegistry
{
    private const LEGACY_ALIASES = [
        'billing.product-create' => AdminRole::BILLING_PRODUCTS_CREATE,
        'billing.product-update' => AdminRole::BILLING_PRODUCTS_UPDATE,
        'billing.product-delete' => AdminRole::BILLING_PRODUCTS_DELETE,
        'billing.category-create' => AdminRole::BILLING_CATEGORIES_CREATE,
        'billing.category-update' => AdminRole::BILLING_CATEGORIES_UPDATE,
        'billing.category-delete' => AdminRole::BILLING_CATEGORIES_DELETE,
        'marketplace.read' => AdminRole::MODS_READ,
        'marketplace.update' => AdminRole::MODS_UPDATE,
        'repositories.read' => AdminRole::EXTENSIONS_READ,
        'repositories.create' => AdminRole::EXTENSIONS_REPOSITORIES,
        'repositories.update' => AdminRole::EXTENSIONS_REPOSITORIES,
        'repositories.delete' => AdminRole::EXTENSIONS_REPOSITORIES,
        'extensions.create' => AdminRole::EXTENSIONS_INSTALL,
    ];

    /**
     * @return list<string>
     */
    public function all(): array
    {
        return AdminRole::permissions()
            ->flatMap(static function (array $group, string $namespace): array {
                return array_map(
                    static fn (string $key): string => $namespace . '.' . $key,
                    array_keys($group['keys'] ?? [])
                );
            })
            ->values()
            ->all();
    }

    public function normalize(string $capability): string
    {
        return self::LEGACY_ALIASES[$capability] ?? $capability;
    }

    /**
     * @param iterable<mixed> $capabilities
     *
     * @return list<string>
     */
    public function normalizeMany(iterable $capabilities): array
    {
        $normalized = [];
        foreach ($capabilities as $capability) {
            if (!is_string($capability) || $capability === '') {
                continue;
            }

            $normalized[] = $this->normalize($capability);
        }

        return array_values(array_unique($normalized));
    }

    /**
     * Normalize a stored permission list and discard unknown identifiers.
     * Unknown capabilities already fail closed at runtime; removing them keeps
     * migrated profiles editable through current validation rules.
     *
     * @param iterable<mixed> $capabilities
     *
     * @return list<string>
     */
    public function valid(iterable $capabilities): array
    {
        $known = array_flip($this->all());

        return array_values(array_filter(
            $this->normalizeMany($capabilities),
            static fn (string $capability): bool => isset($known[$capability])
        ));
    }

    public function isValid(string $capability): bool
    {
        return in_array($this->normalize($capability), $this->all(), true);
    }

    /**
     * @param iterable<mixed> $capabilities
     *
     * @return list<string>
     */
    public function invalid(iterable $capabilities): array
    {
        $valid = array_flip($this->all());
        $invalid = [];

        foreach ($capabilities as $capability) {
            if (!is_string($capability) || !isset($valid[$this->normalize($capability)])) {
                $invalid[] = is_scalar($capability) ? (string) $capability : get_debug_type($capability);
            }
        }

        return array_values(array_unique($invalid));
    }

    public function isApiEligible(AdminRole $profile): bool
    {
        return !$profile->isOwner() && (bool) $profile->api_eligible;
    }

    /**
     * Expand historical broad node/server permissions into the granular
     * capabilities that now protect their nested resources.
     *
     * @param iterable<mixed> $capabilities
     *
     * @return list<string>
     */
    public function expandLegacyProfile(iterable $capabilities): array
    {
        $expanded = $this->normalizeMany($capabilities);

        if (in_array(AdminRole::NODES_READ, $expanded, true)) {
            $expanded[] = AdminRole::ALLOCATIONS_READ;
        }
        if (in_array(AdminRole::NODES_UPDATE, $expanded, true)) {
            $expanded[] = AdminRole::ALLOCATIONS_CREATE;
            $expanded[] = AdminRole::ALLOCATIONS_DELETE;
        }
        if (in_array(AdminRole::NODES_DELETE, $expanded, true)) {
            $expanded[] = AdminRole::ALLOCATIONS_DELETE;
        }
        if (in_array(AdminRole::SERVERS_READ, $expanded, true)) {
            $expanded[] = AdminRole::SERVER_DATABASES_READ;
        }
        if (in_array(AdminRole::DATABASES_READ, $expanded, true)) {
            $expanded[] = AdminRole::SERVER_DATABASES_READ;
        }
        if (in_array(AdminRole::SERVERS_UPDATE, $expanded, true)) {
            $expanded[] = AdminRole::SERVER_DATABASES_CREATE;
            $expanded[] = AdminRole::SERVER_DATABASES_UPDATE;
            $expanded[] = AdminRole::SERVER_DATABASES_DELETE;
        }

        return array_values(array_unique($expanded));
    }
}
