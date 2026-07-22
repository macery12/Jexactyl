<?php

namespace Everest\Services\Migration\Profiles;

use Illuminate\Database\Connection;
use Everest\Services\Migration\TablePlan;
use Everest\Services\Migration\ImportContext;
use Everest\Services\Migration\ImportSummary;

/**
 * JexPanel v4.x — the closest relative of this panel's schema.
 *
 * It already uses the modern node column names and shares the billing, groups
 * and ticket tables, so most of it copies straight across and the billing side
 * can come with it.
 */
class JexpanelProfile extends PterodactylProfile
{
    public function key(): string
    {
        return 'jexpanel';
    }

    public function name(): string
    {
        return 'JexPanel';
    }

    public function supportedVersion(): string
    {
        return '4.x';
    }

    protected function tablePlans(): array
    {
        $plans = parent::tablePlans();

        // Roles have to exist before users, which reference them.
        $plans = array_merge(['admin_roles' => new TablePlan(table: 'admin_roles')], $plans);

        $plans['users'] = new TablePlan(
            table: 'users',
            transforms: ['totp_secret' => fn ($v, $row, ImportContext $ctx) => $ctx->rewrap($v)],
        );

        // Already on the modern column names — nothing to rename or drop.
        $plans['nodes'] = new TablePlan(
            table: 'nodes',
            transforms: ['daemon_token' => fn ($v, $row, ImportContext $ctx) => $ctx->rewrap($v)],
        );

        $plans['servers'] = new TablePlan(
            table: 'servers',
            // Group membership became a pivot table here; see afterImport().
            converted: ['group_id' => 'group membership is rebuilt into server_group_members'],
        );

        return array_merge($plans, [
            'server_groups' => new TablePlan(table: 'server_groups', group: TablePlan::GROUP_BILLING),
            'server_presets' => new TablePlan(table: 'server_presets', group: TablePlan::GROUP_BILLING),
            'categories' => new TablePlan(table: 'categories', group: TablePlan::GROUP_BILLING),
            'products' => new TablePlan(table: 'products', group: TablePlan::GROUP_BILLING),
            'orders' => new TablePlan(
                table: 'orders',
                drops: ['transaction_id' => 'payment references are recorded per processor in this panel'],
                group: TablePlan::GROUP_BILLING,
            ),
            'billing_exceptions' => new TablePlan(table: 'billing_exceptions', group: TablePlan::GROUP_BILLING),
            'tickets' => new TablePlan(table: 'tickets', group: TablePlan::GROUP_BILLING),
            'ticket_messages' => new TablePlan(table: 'ticket_messages', group: TablePlan::GROUP_BILLING),
            'custom_links' => new TablePlan(table: 'custom_links', group: TablePlan::GROUP_BILLING),
            'webhook_events' => new TablePlan(table: 'webhook_events', group: TablePlan::GROUP_BILLING),
            'theme' => new TablePlan(table: 'theme', group: TablePlan::GROUP_BILLING),
        ]);
    }

    /**
     * JexPanel puts a server's group in servers.group_id; this panel uses a
     * server_group_members pivot. Rebuild it from the column that was dropped.
     */
    public function afterImport(Connection $source, Connection $target, ImportSummary $summary): void
    {
        if (!array_key_exists('server_groups', $summary->copied)) {
            return;
        }

        $rows = [];
        $source->table('servers')
            ->whereNotNull('group_id')
            ->select('id', 'group_id')
            ->orderBy('id')
            ->each(function ($server) use (&$rows) {
                $rows[] = ['server_id' => $server->id, 'server_group_id' => $server->group_id];
            });

        foreach (array_chunk($rows, 500) as $chunk) {
            $target->table('server_group_members')->insert($chunk);
        }

        $summary->copied('server_group_members', count($rows));
        $summary->note('Rebuilt server_group_members from servers.group_id.');
    }

    public function excludedTables(): array
    {
        $excluded = array_merge(parent::excludedTables(), [
            'subscriptions' => 'recurring subscriptions were removed from this panel; convert affected servers to a billing product manually',
            'subscription_items' => 'recurring subscriptions were removed from this panel',
            'discount_codes' => 'discount codes are replaced by coupons; recreate them in this panel',
            'jguard_delay' => 'anti-abuse timers are transient state',
        ]);

        // JexPanel has no locations table, so the inherited note does not apply.
        unset($excluded['locations']);

        return $excluded;
    }

    public function warnings(): array
    {
        return [
            'Panel settings are not imported. Configure this panel (mail, billing, branding) from scratch after importing.',
            'Recurring subscriptions are NOT imported — this panel dropped them in favour of billing products. Any server that was paid for by a subscription will import without a billing plan attached; review those servers afterwards.',
            'Discount codes are not imported; recreate them as coupons.',
        ];
    }
}
