<?php

namespace Everest\Services\Migration\Profiles;

use Everest\Services\Migration\TablePlan;
use Everest\Services\Migration\ImportContext;

/**
 * Jexactyl v3.x.
 *
 * Shares Pterodactyl's core schema and adds a store/credits economy, referrals
 * and analytics on top. This panel bills through orders and products instead,
 * so none of the store side maps and it is left behind explicitly.
 */
class JexactylProfile extends PterodactylProfile
{
    public function key(): string
    {
        return 'jexactyl';
    }

    public function name(): string
    {
        return 'Jexactyl';
    }

    public function supportedVersion(): string
    {
        return '3.x';
    }

    protected function tablePlans(): array
    {
        $plans = parent::tablePlans();

        $plans['users'] = new TablePlan(
            table: 'users',
            drops: [
                'name_first' => 'this panel identifies users by username only',
                'name_last' => 'this panel identifies users by username only',
                'approved' => 'this panel has no account approval queue',
                'discord_id' => 'link Discord accounts again after importing',
                'ip' => 'last-seen IP is not carried over',
                'referral_code' => 'this panel has no referral system',
                'store_balance' => 'store credits do not map to this panel\'s billing model',
                'store_cpu' => 'store resources do not map to this panel\'s billing model',
                'store_memory' => 'store resources do not map to this panel\'s billing model',
                'store_disk' => 'store resources do not map to this panel\'s billing model',
                'store_slots' => 'store resources do not map to this panel\'s billing model',
                'store_ports' => 'store resources do not map to this panel\'s billing model',
                'store_backups' => 'store resources do not map to this panel\'s billing model',
                'store_databases' => 'store resources do not map to this panel\'s billing model',
            ],
            converted: ['verified' => 'verified accounts become email_verified_at'],
            defaults: [
                'email_verified_at' => fn (array $row) => $row['verified'] ? $row['created_at'] : null,
            ],
            transforms: ['totp_secret' => fn ($v, $row, ImportContext $ctx) => $ctx->rewrap($v)],
        );

        $plans['nests'] = new TablePlan(
            table: 'nests',
            drops: ['private' => 'nest visibility is controlled per category in this panel'],
        );

        $plans['nodes'] = new TablePlan(
            table: 'nodes',
            renames: [
                'daemonBase' => 'daemon_base',
                'daemonListen' => 'listen_port_http',
                'daemonSFTP' => 'listen_port_sftp',
            ],
            drops: [
                'location_id' => 'locations were removed from this panel; node grouping is not carried over',
                'deploy_fee' => 'per-node deploy fees are replaced by node price multipliers',
            ],
            defaults: [
                'public_port_http' => fn (array $row) => $row['daemonListen'],
                'public_port_sftp' => fn (array $row) => $row['daemonSFTP'],
            ],
            transforms: ['daemon_token' => fn ($v, $row, ImportContext $ctx) => $ctx->rewrap($v)],
        );

        $plans['servers'] = new TablePlan(
            table: 'servers',
            renames: ['oom_disabled' => 'oom_killer'],
            drops: [
                'bg' => 'per-server background images are not supported',
                'renewable' => 'server renewals are driven by billing products in this panel',
                // Jexactyl stores days remaining; this panel stores a renewal
                // date. Deriving one from the other would invent a date.
                'renewal' => 'renewal is a day counter here and a date in this panel',
            ],
            transforms: ['oom_killer' => fn ($v) => $v ? 0 : 1],
        );

        return $plans;
    }

    public function excludedTables(): array
    {
        return array_merge(parent::excludedTables(), [
            'paypal' => 'store top-up history does not map to this panel\'s billing model',
            'referral_codes' => 'this panel has no referral system',
            'referral_uses' => 'this panel has no referral system',
            'analytics_data' => 'Jexactyl analytics have no equivalent here',
            'analytics_messages' => 'Jexactyl analytics have no equivalent here',
            'verification_tokens' => 'pending verification links are invalidated by the move',
            'coupons' => 'coupon rules differ; recreate coupons in this panel',
            'tickets' => 'ticket bodies are stored as messages in this panel; support history is not carried over',
            'ticket_messages' => 'ticket bodies are stored as messages in this panel; support history is not carried over',
            'theme' => 'theming is stored differently; pick a theme preset after importing',
        ]);
    }

    public function warnings(): array
    {
        return array_merge(parent::warnings(), [
            'Store credits and store-purchased resources are NOT imported. This panel bills through products and orders, and there is no honest way to convert a credit balance into it. Record balances before importing if you intend to compensate users.',
            'Support tickets, coupons and theme settings are not imported.',
        ]);
    }
}
