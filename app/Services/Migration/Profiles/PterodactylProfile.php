<?php

namespace Everest\Services\Migration\Profiles;

use Illuminate\Database\Connection;
use Everest\Services\Migration\TablePlan;
use Everest\Services\Migration\ImportContext;
use Everest\Services\Migration\ImportProfile;
use Everest\Services\Migration\ImportSummary;
use Everest\Services\Api\LegacyApplicationKeyProfileMigrationService;

/**
 * Pterodactyl 1.11.x — the common ancestor of every panel this importer reads.
 *
 * Jexactyl and JexPanel extend this and adjust the tables their forks changed,
 * so the shared core lives here.
 */
class PterodactylProfile extends ImportProfile
{
    public function key(): string
    {
        return 'pterodactyl';
    }

    public function name(): string
    {
        return 'Pterodactyl';
    }

    public function supportedVersion(): string
    {
        return '1.11.x';
    }

    public function tables(): array
    {
        return array_values($this->tablePlans());
    }

    /**
     * Keyed by target table and held in foreign-key dependency order, so forks
     * can replace a plan without disturbing the ordering.
     *
     * @return array<string, TablePlan>
     */
    protected function tablePlans(): array
    {
        $apiKeyResources = [
            'r_servers',
            'r_nodes',
            'r_allocations',
            'r_users',
            'r_locations',
            'r_nests',
            'r_eggs',
            'r_database_hosts',
            'r_server_databases',
        ];
        $apiKeyTransforms = [
            'token' => fn ($v, $row, ImportContext $ctx) => $ctx->rewrap($v),
        ];
        foreach ($apiKeyResources as $column) {
            $apiKeyTransforms[$column] = static fn ($value) => (int) $value === 2 ? 3 : $value;
        }

        return [
            'users' => $this->usersPlan(),
            'api_keys' => new TablePlan(
                table: 'api_keys',
                defaults: [
                    'acl_enforced' => static function (array $row): bool {
                        return (int) ($row['key_type'] ?? 0) === 2;
                    },
                ],
                transforms: $apiKeyTransforms,
            ),
            'recovery_tokens' => new TablePlan(table: 'recovery_tokens'),
            'user_ssh_keys' => new TablePlan(table: 'user_ssh_keys'),

            'nests' => new TablePlan(table: 'nests'),
            'eggs' => new TablePlan(
                table: 'eggs',
                drops: ['config_logs' => 'log configuration was removed from eggs upstream'],
            ),
            'egg_variables' => new TablePlan(table: 'egg_variables'),

            'database_hosts' => new TablePlan(
                table: 'database_hosts',
                drops: ['node_id' => 'database hosts are no longer tied to a single node'],
                transforms: ['password' => fn ($v, $row, ImportContext $ctx) => $ctx->rewrap($v)],
            ),
            'nodes' => $this->nodesPlan(),
            'allocations' => new TablePlan(table: 'allocations'),

            'servers' => $this->serversPlan(),
            'server_variables' => new TablePlan(table: 'server_variables'),
            'subusers' => new TablePlan(table: 'subusers'),
            'databases' => new TablePlan(
                table: 'databases',
                transforms: ['password' => fn ($v, $row, ImportContext $ctx) => $ctx->rewrap($v)],
            ),
            'backups' => new TablePlan(table: 'backups'),
            'schedules' => new TablePlan(table: 'schedules'),
            'tasks' => new TablePlan(table: 'tasks'),
            'server_transfers' => new TablePlan(table: 'server_transfers'),

            'mounts' => new TablePlan(table: 'mounts'),
            'egg_mount' => new TablePlan(table: 'egg_mount'),
            'mount_node' => new TablePlan(table: 'mount_node'),
            'mount_server' => new TablePlan(table: 'mount_server'),

            'activity_logs' => new TablePlan(table: 'activity_logs', group: TablePlan::GROUP_LOGS),
            'activity_log_subjects' => new TablePlan(table: 'activity_log_subjects', group: TablePlan::GROUP_LOGS),
            'audit_logs' => new TablePlan(table: 'audit_logs', group: TablePlan::GROUP_LOGS),
            'api_logs' => new TablePlan(table: 'api_logs', group: TablePlan::GROUP_LOGS),
            'tasks_log' => new TablePlan(table: 'tasks_log', group: TablePlan::GROUP_LOGS),
        ];
    }

    protected function usersPlan(): TablePlan
    {
        return new TablePlan(
            table: 'users',
            drops: [
                'name_first' => 'this panel identifies users by username only',
                'name_last' => 'this panel identifies users by username only',
            ],
            transforms: ['totp_secret' => fn ($v, $row, ImportContext $ctx) => $ctx->rewrap($v)],
        );
    }

    protected function nodesPlan(): TablePlan
    {
        return new TablePlan(
            table: 'nodes',
            renames: [
                'daemonBase' => 'daemon_base',
                'daemonListen' => 'listen_port_http',
                'daemonSFTP' => 'listen_port_sftp',
            ],
            drops: [
                'location_id' => 'locations were removed from this panel; node grouping is not carried over',
            ],
            // Wings is reached on the listening ports unless a proxy says
            // otherwise, so seed the public ports from them rather than letting
            // a node with custom ports fall back to the 8080/2022 defaults.
            defaults: [
                'public_port_http' => fn (array $row) => $row['daemonListen'],
                'public_port_sftp' => fn (array $row) => $row['daemonSFTP'],
            ],
            transforms: ['daemon_token' => fn ($v, $row, ImportContext $ctx) => $ctx->rewrap($v)],
        );
    }

    protected function serversPlan(): TablePlan
    {
        return new TablePlan(
            table: 'servers',
            // Same setting, opposite polarity: Pterodactyl stores whether the
            // OOM killer is disabled, this panel stores whether it is enabled.
            renames: ['oom_disabled' => 'oom_killer'],
            transforms: ['oom_killer' => fn ($v) => $v ? 0 : 1],
        );
    }

    public function afterImport(Connection $source, Connection $target, ImportSummary $summary): void
    {
        $ownerId = $target->table('admin_roles')->where('is_owner', true)->value('id');
        if ($ownerId === null) {
            throw new \RuntimeException('The built-in Owner Access Profile is missing from the target database.');
        }

        $migratedOwners = $target->table('users')
            ->where('root_admin', true)
            ->update(['admin_role_id' => $ownerId]);
        $summary->note("Assigned {$migratedOwners} imported root administrator(s) to the Owner Access Profile.");

        app(LegacyApplicationKeyProfileMigrationService::class)->handle($target);
        $summary->note('Bound imported Application API keys to generated API-eligible access profiles.');
    }

    public function excludedTables(): array
    {
        return [
            'settings' => 'panel configuration is not portable — it is keyed differently and its secrets are encrypted with the old APP_KEY',
            'locations' => 'this panel has no locations concept',
            'sessions' => 'login sessions do not survive a move; users sign in again',
            'jobs' => 'queued jobs reference the old panel',
            'failed_jobs' => 'queued jobs reference the old panel',
            'notifications' => 'delivered notifications are not carried over',
            'password_resets' => 'pending reset links are invalidated by the move',
            'migrations' => 'migration bookkeeping belongs to this panel',
        ];
    }

    public function warnings(): array
    {
        return [
            'User first and last names are not imported — this panel identifies users by username. Usernames, emails, password hashes and 2FA secrets are preserved.',
            'Node locations are not imported; this panel has no locations concept. Note your existing location grouping before importing if you rely on it.',
            'Panel settings are not imported. Configure this panel (mail, billing, branding) from scratch after importing.',
        ];
    }
}
