<?php

namespace Everest\Services\Migration;

use Illuminate\Database\Connection;
use Everest\Services\Authorization\AdminCapabilityRegistry;

/**
 * Imports JexPanel roles as custom Access Profiles without colliding with the
 * built-in Owner row seeded by this panel's migrations.
 */
class JexpanelAccessProfileImportService
{
    public function __construct(private AdminCapabilityRegistry $capabilities)
    {
    }

    public function handle(Connection $source, Connection $target, ImportSummary $summary): void
    {
        $sourceProfiles = $source->table('admin_roles')->orderBy('id')->get();
        $occupied = $target->table('admin_roles')->pluck('id')->map(static fn ($id): int => (int) $id)->all();
        $reserved = array_merge(
            $occupied,
            $sourceProfiles->pluck('id')->map(static fn ($id): int => (int) $id)->all()
        );
        $nextId = ($reserved === [] ? 0 : max($reserved)) + 1;
        $mapping = [];

        foreach ($sourceProfiles as $sourceProfile) {
            $sourceId = (int) $sourceProfile->id;
            if (!in_array($sourceId, $occupied, true)) {
                $targetId = $sourceId;
            } else {
                while (in_array($nextId, $reserved, true) || in_array($nextId, $occupied, true)) {
                    ++$nextId;
                }
                $targetId = $nextId++;
            }

            $rawPermissions = json_decode($sourceProfile->permissions ?? '[]', true);
            $target->table('admin_roles')->insert([
                'id' => $targetId,
                'name' => $sourceProfile->name,
                'description' => $sourceProfile->description ?? null,
                'sort_id' => (int) ($sourceProfile->sort_id ?? 99),
                'permissions' => json_encode($this->capabilities->expandLegacyProfile(
                    is_array($rawPermissions) ? $rawPermissions : []
                )),
                'color' => $sourceProfile->color ?? null,
                'is_system' => false,
                'is_owner' => false,
                // Human profiles are never exposed to API keys without an
                // explicit post-import opt-in by an Owner.
                'api_eligible' => false,
            ]);

            $mapping[$sourceId] = $targetId;
            $occupied[] = $targetId;
        }

        $assigned = 0;
        $source->table('users')
            ->whereNotNull('admin_role_id')
            ->select('id', 'admin_role_id')
            ->orderBy('id')
            ->each(function ($sourceUser) use ($target, $mapping, &$assigned): void {
                $targetProfileId = $mapping[(int) $sourceUser->admin_role_id] ?? null;
                if ($targetProfileId === null) {
                    throw new \RuntimeException("Imported user {$sourceUser->id} references missing admin role {$sourceUser->admin_role_id}.");
                }

                $assigned += $target->table('users')
                    ->where('id', $sourceUser->id)
                    ->update(['admin_role_id' => $targetProfileId]);
            });

        $summary->copied('admin_roles', count($mapping));
        $summary->note(sprintf(
            'Imported %d custom Access Profile(s) and restored %d user assignment(s) without colliding with Owner.',
            count($mapping),
            $assigned
        ));
    }
}
