<?php

namespace Everest\Console\Commands\Email;

use Carbon\Carbon;
use Ramsey\Uuid\Uuid;
use Everest\Models\Server;
use Illuminate\Console\Command;
use Everest\Models\EmailDelivery;
use Everest\Models\Billing\Product;
use Illuminate\Support\Facades\Log;
use Everest\Events\Email\ServerRenewalNotice;

class SendServerRenewalNoticesCommand extends Command
{
    private const CORRELATION_SEED = 'renewal-notice:server-%d-days-%d';

    /**
     * The name and signature of the console command.
     */
    protected $signature = 'email:send-renewal-notices
                            {--days=7 : Send notices for servers expiring in exactly X days (per-day window)}
                            {--dry-run : Preview servers without sending emails}';

    /**
     * The console command description.
     */
    protected $description = 'Send renewal notices to users with servers expiring soon';

    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $daysAhead = (int) $this->option('days');
        $isDryRun = $this->option('dry-run');

        $now = Carbon::now();
        $this->info("Finding servers expiring in {$daysAhead} day(s)...");

        // Calculate the date range for the target day window
        $targetDate = $now->copy()->addDays($daysAhead);
        $renewalStart = $targetDate->copy()->startOfDay();
        $renewalEnd = $targetDate->copy()->endOfDay();

        // Find servers with renewal date in the specified timeframe
        // Only send for active servers (not suspended or already expired)
        $servers = Server::whereNotNull('renewal_date')
            ->whereBetween('renewal_date', [$renewalStart, $renewalEnd])
            ->where(function ($query) {
                $blocked = [
                    Server::STATUS_SUSPENDED,
                    Server::STATUS_INSTALLING,
                    Server::STATUS_INSTALL_FAILED,
                    Server::STATUS_REINSTALL_FAILED,
                    Server::STATUS_RESTORING_BACKUP,
                ];

                $query->whereNull('status')
                    ->orWhere(function ($inner) use ($blocked) {
                        $inner->whereNotNull('status')
                            ->whereNotIn('status', $blocked);
                    });
            })
            ->with(['user', 'node'])
            ->get();

        if ($servers->isEmpty()) {
            $this->info("No servers found with renewal exactly {$daysAhead} day(s) away.");

            return Command::SUCCESS;
        }

        $this->info("Found {$servers->count()} server(s) with renewal in {$daysAhead} day(s)");

        // Precompute correlation IDs and cache existing deliveries for deduplication in a single query
        $correlationIds = [];
        foreach ($servers as $server) {
            $correlationIds[$server->id] = $this->buildCorrelationId($server, $daysAhead);
        }

        $existingCorrelationIds = $this->getExistingCorrelationIds(array_values($correlationIds));

        $sentCount = 0;
        $skippedCount = 0;

        foreach ($servers as $server) {
            if (!$server->user) {
                $this->warn("Skipping server {$server->id}: no user associated");
                ++$skippedCount;
                continue;
            }

            $daysUntilRenewal = $daysAhead;
            $correlationId = $correlationIds[$server->id];

            if (isset($existingCorrelationIds[$correlationId])) {
                $this->line("Skipping server {$server->id}: renewal notice for {$daysAhead} day(s) already sent or pending");
                ++$skippedCount;
                continue;
            }

            if ($isDryRun) {
                $this->line("Would send renewal notice for server: {$server->name} (ID: {$server->id}) - User: {$server->user->email}");
                continue;
            }

            try {
                $this->sendRenewalNotice($server, $daysAhead, $correlationId, $daysUntilRenewal);
                ++$sentCount;
                $this->info("✓ Sent renewal notice for server: {$server->name} (ID: {$server->id})");
            } catch (\Exception $e) {
                $this->error("✗ Failed to send renewal notice for server {$server->id}: " . $e->getMessage());
                Log::error("Failed to send renewal notice for server {$server->id}", [
                    'error' => $e->getMessage(),
                    'server_id' => $server->id,
                    'user_id' => $server->owner_id,
                ]);
                ++$skippedCount;
            }
        }

        if ($isDryRun) {
            $this->info("\nDry run complete. No emails were sent.");
        } else {
            $this->info("\nRenewal notices sent: {$sentCount}");
            if ($skippedCount > 0) {
                $this->warn("Skipped: {$skippedCount}");
            }
        }

        return Command::SUCCESS;
    }

    /**
     * Send renewal notice for a server.
     */
    private function sendRenewalNotice(Server $server, int $targetDaysAhead, string $correlationId, int $daysUntilRenewal): void
    {
        $currency = config('modules.billing.currency.code', 'USD');

        // Get renewal amount from server's billing amount or default to 0
        $renewalAmount = $server->billing_amount;
        if ($renewalAmount === null && $server->billing_product_id) {
            $product = Product::find($server->billing_product_id);
            $renewalAmount = $product?->price ?? 0;
        }
        $renewalAmount = $renewalAmount ?? 0;

        // Get billing cycle (days) - defaults to 30 if not set
        $billingDays = $server->billing_days ?? 30;

        // Calculate suspension time (typically renewal_date + 1 day)
        $suspensionTime = $server->renewal_date->copy()->addDay();

        // Generate renewal URL pointing to server billing page
        $renewalUrl = url("/server/{$server->uuidShort}/billing");

        event(new ServerRenewalNotice(
            user: $server->user,
            server: $server,
            renewalUrl: $renewalUrl,
            renewalDate: $server->renewal_date->format('F j, Y \a\t g:i A'),
            suspensionTime: $suspensionTime->format('F j, Y \a\t g:i A'),
            renewalAmount: $renewalAmount,
            currency: $currency,
            billingDays: $billingDays,
            correlationId: $correlationId,
        ));

        Log::info("Sent renewal notice for server {$server->id}", [
            'server_id' => $server->id,
            'user_id' => $server->owner_id,
            'renewal_date' => $server->renewal_date->toDateTimeString(),
            'days_until_renewal' => $daysUntilRenewal,
            'notice_stage_days' => $targetDaysAhead,
            'billing_days' => $billingDays,
        ]);
    }

    /**
     * Build a deterministic correlation ID for a server/day combination.
     */
    private function buildCorrelationId(Server $server, int $targetDaysAhead): string
    {
        // Keep correlation IDs stable per server and day-distance to avoid duplicate sends in a window
        $seed = sprintf(self::CORRELATION_SEED, $server->id, $targetDaysAhead);

        return Uuid::uuid5(Uuid::NAMESPACE_URL, $seed)->toString();
    }

    /**
     * Fetch existing correlation IDs in bulk to avoid N+1 queries.
     */
    private function getExistingCorrelationIds(array $correlationIds): array
    {
        try {
            $existing = EmailDelivery::whereIn('correlation_id', $correlationIds)
                ->whereIn('status', [
                    EmailDelivery::STATUS_QUEUED,
                    EmailDelivery::STATUS_SENDING,
                    EmailDelivery::STATUS_SENT,
                    EmailDelivery::STATUS_DEFERRED,
                ])
                ->pluck('correlation_id')
                ->all();

            return array_flip($existing);
        } catch (\Throwable $e) {
            // If logging tables are missing, avoid blocking email sending
            Log::warning('Skipping renewal notice deduplication check; email_deliveries table unavailable', [
                'error' => $e->getMessage(),
            ]);

            return [];
        }
    }
}
