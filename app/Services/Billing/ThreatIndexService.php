<?php

namespace Everest\Services\Billing;

use Carbon\Carbon;
use Everest\Models\User;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\Log;
use Everest\Services\Email\EmailSettingsReader;

class ThreatIndexService
{
    /**
     * Email domains considered reputable for risk scoring.
     * Orders from these domains receive no domain-risk penalty.
     */
    private const REPUTABLE_DOMAINS = [
        'gmail.com',
        'yahoo.com',
        'outlook.com',
        'hotmail.com',
        'icloud.com',
        'zoho.com',
        'aol.com',
        'protonmail.com',
        'mail.com',
        'yandex.com',
        'office.com',
        'outlook.co.uk',
        'live.com',
        'live.co.uk',
        'msn.com',
        'sky.com',
        'me.com',
        'btinternet.com',
    ];

    public function __construct(private readonly EmailSettingsReader $emailSettings)
    {
    }

    /**
     * Compute the threat index for an order.
     * Returns an integer in [0, 100] where 0 is lowest risk and 100 is highest.
     * Returns 0 if the order's user cannot be resolved.
     */
    public function calculate(Order $order): int
    {
        // Eager-load what we need if not already loaded.
        $order->loadMissing(['user', 'transaction']);

        $user = $order->user;

        if (!$user instanceof User) {
            Log::warning('ThreatIndexService: user not found for order', ['order_id' => $order->id, 'user_id' => $order->user_id]);

            return 0;
        }

        // Short-circuit: suspended accounts are maximum threat.
        if ($user->isSuspended()) {
            return 100;
        }

        $score = 0;
        $score += $this->accountAgeRisk($user);
        $score += $this->accountSecurityRisk($user);
        $score += $this->emailDomainRisk($user);
        $score += $this->paymentHistoryRisk($order, $user);
        $score += $this->orderSignalRisk($order);
        $score += $this->sessionIpRisk($user);
        $score += $this->orderVelocityRisk($order, $user);

        return min(100, max(0, $score));
    }

    /**
     * Calculate and persist the threat index for an order.
     */
    public function recalculate(Order $order): void
    {
        $order->update(['threat_index' => $this->calculate($order)]);
    }

    /**
     * Return a detailed breakdown of every signal that contributed to (or was
     * evaluated for) an order's threat score. Useful for admin inspection.
     *
     * Each entry has:
     *   category    – human-readable signal group name
     *   description – why the signal fired (or didn't)
     *   points      – points actually added by this signal
     *   max_points  – maximum this signal can contribute
     *   fired       – whether any points were added
     *
     * @return array{score: int, signals: list<array{category: string, description: string, points: int, max_points: int, fired: bool}>}
     */
    public function breakdown(Order $order): array
    {
        $order->loadMissing(['user', 'transaction']);

        $user = $order->user;

        if (!$user instanceof User) {
            return [
                'score' => 0,
                'signals' => [
                    [
                        'category' => 'User',
                        'description' => 'User account not found — order may be orphaned.',
                        'points' => 0,
                        'max_points' => 100,
                        'fired' => false,
                    ],
                ],
            ];
        }

        if ($user->isSuspended()) {
            return [
                'score' => 100,
                'signals' => [
                    [
                        'category' => 'Account Suspended',
                        'description' => 'User account is suspended — maximum threat score applied.',
                        'points' => 100,
                        'max_points' => 100,
                        'fired' => true,
                    ],
                ],
            ];
        }

        $signals = [];
        $total = 0;

        // Account Age
        $agePoints = $this->accountAgeRisk($user);
        $total += $agePoints;
        $ageHours = $user->created_at->diffInHours(now());
        $ageLabel = $ageHours < 24
            ? "Account created {$ageHours}h ago"
            : ($user->created_at->diffInDays(now()) < 7
                ? 'Account created ' . $user->created_at->diffInDays(now()) . ' day(s) ago'
                : ($user->created_at->diffInDays(now()) < 30
                    ? 'Account created ' . $user->created_at->diffInDays(now()) . ' day(s) ago'
                    : 'Account created ' . $user->created_at->diffForHumans()));
        $signals[] = [
            'category' => 'Account Age',
            'description' => $agePoints > 0
                ? "{$ageLabel} — new accounts carry higher risk."
                : "{$ageLabel} — account is established.",
            'points' => $agePoints,
            'max_points' => 25,
            'fired' => $agePoints > 0,
        ];

        // 2FA
        $totpPoints = $user->use_totp ? 0 : 10;
        $total += $totpPoints;
        $signals[] = [
            'category' => '2FA Disabled',
            'description' => $user->use_totp
                ? 'Two-factor authentication is enabled.'
                : 'Two-factor authentication is not enabled.',
            'points' => $totpPoints,
            'max_points' => 10,
            'fired' => $totpPoints > 0,
        ];

        // Email verification
        $emailDeliveryEnabled = $this->emailSettings->deliveryEnabled();
        $verifiedPoints = 0;
        if ($emailDeliveryEnabled && !$user->hasVerifiedEmail()) {
            $verifiedPoints = 10;
        }
        $total += $verifiedPoints;
        $verifiedDescription = !$emailDeliveryEnabled
            ? 'Email delivery is disabled — verification status not scored.'
            : ($user->hasVerifiedEmail() ? 'Email address has been verified.' : 'Email address is not verified.');
        $signals[] = [
            'category' => 'Email Verification',
            'description' => $verifiedDescription,
            'points' => $verifiedPoints,
            'max_points' => 10,
            'fired' => $verifiedPoints > 0,
        ];

        // Email domain
        $domain = strtolower(substr(strrchr($user->email, '@'), 1));
        $domainPoints = in_array($domain, self::REPUTABLE_DOMAINS, true) ? 0 : 15;
        $total += $domainPoints;
        $signals[] = [
            'category' => 'Email Domain',
            'description' => $domainPoints > 0
                ? "@{$domain} is not a commonly recognised provider."
                : "@{$domain} is a reputable email provider.",
            'points' => $domainPoints,
            'max_points' => 15,
            'fired' => $domainPoints > 0,
        ];

        // Payment history — prior successes
        $userOrders = Order::where('user_id', $user->id)
            ->whereIn('status', [Order::STATUS_PROCESSED, Order::STATUS_FAILED])
            ->get(['id', 'status', 'created_at']);

        $priorSuccessCount = $userOrders->where('status', Order::STATUS_PROCESSED)->count();
        $noHistoryPoints = $priorSuccessCount === 0 ? 10 : 0;
        $total += $noHistoryPoints;
        $signals[] = [
            'category' => 'No Prior Successful Payments',
            'description' => $noHistoryPoints > 0
                ? 'No previous successfully processed orders on this account.'
                : "{$priorSuccessCount} prior successful payment(s) on record.",
            'points' => $noHistoryPoints,
            'max_points' => 10,
            'fired' => $noHistoryPoints > 0,
        ];

        // Payment history — recent failures
        $recentFailures = Order::where('user_id', $user->id)
            ->where('status', Order::STATUS_FAILED)
            ->where('created_at', '>=', now()->subDays(30))
            ->count();
        $failurePoints = $recentFailures >= 2 ? 15 : ($recentFailures >= 1 ? 10 : 0);
        $total += $failurePoints;
        $signals[] = [
            'category' => 'Recent Failed Payments',
            'description' => $recentFailures > 0
                ? "{$recentFailures} failed payment(s) in the last 30 days."
                : 'No failed payments in the last 30 days.',
            'points' => $failurePoints,
            'max_points' => 15,
            'fired' => $failurePoints > 0,
        ];

        // Payer email mismatch
        $payerEmail = $order->transaction?->payer_email;
        $mismatchPoints = ($payerEmail && strtolower($payerEmail) !== strtolower($user->email)) ? 15 : 0;
        $total += $mismatchPoints;
        $signals[] = [
            'category' => 'Payer Email Mismatch',
            'description' => $mismatchPoints > 0
                ? "Payment made with {$payerEmail} but account email is {$user->email}."
                : ($payerEmail
                    ? 'Payer email matches the account email.'
                    : 'No payer email recorded for this order.'),
            'points' => $mismatchPoints,
            'max_points' => 15,
            'fired' => $mismatchPoints > 0,
        ];

        // Order type
        $typePoints = $order->type !== Order::TYPE_REN ? 5 : 0;
        $total += $typePoints;
        $signals[] = [
            'category' => 'Order Type',
            'description' => $typePoints > 0
                ? 'New purchase or upgrade (not a renewal) — slightly higher inherent risk.'
                : 'Renewal order — established billing relationship.',
            'points' => $typePoints,
            'max_points' => 5,
            'fired' => $typePoints > 0,
        ];

        // High value
        $highValueThreshold = (float) config('billing.threat.high_value_threshold', 50.0);
        $highValuePoints = (float) $order->total > $highValueThreshold ? 5 : 0;
        $total += $highValuePoints;
        $signals[] = [
            'category' => 'High-Value Order',
            'description' => $highValuePoints > 0
                ? "Order total \${$order->total} exceeds the high-value threshold of \${$highValueThreshold}."
                : "Order total \${$order->total} is below the high-value threshold of \${$highValueThreshold}.",
            'points' => $highValuePoints,
            'max_points' => 5,
            'fired' => $highValuePoints > 0,
        ];

        // Session IP diversity
        $distinctIps = $user->sessions()
            ->active()
            ->where('created_at', '>=', now()->subDay())
            ->whereNotNull('ip_address')
            ->distinct('ip_address')
            ->count('ip_address');
        $ipPoints = $distinctIps >= 3 ? 10 : ($distinctIps >= 2 ? 5 : 0);
        $total += $ipPoints;
        $signals[] = [
            'category' => 'Session IP Diversity',
            'description' => $distinctIps >= 2
                ? "{$distinctIps} distinct IP address(es) seen in active sessions in the last 24h."
                : 'Single IP address across recent sessions.',
            'points' => $ipPoints,
            'max_points' => 10,
            'fired' => $ipPoints > 0,
        ];

        // Order velocity
        $recentOrderCount = Order::where('user_id', $user->id)
            ->whereIn('type', [Order::TYPE_NEW, Order::TYPE_UPG])
            ->where('id', '!=', $order->id)
            ->where('created_at', '>=', now()->subDay())
            ->count();
        $velocityPoints = $recentOrderCount >= 2 ? 15 : ($recentOrderCount >= 1 ? 10 : 0);
        $total += $velocityPoints;
        $signals[] = [
            'category' => 'Order Velocity',
            'description' => $recentOrderCount > 0
                ? "{$recentOrderCount} other new/upgrade order(s) placed in the last 24h."
                : 'No other new or upgrade orders in the last 24h.',
            'points' => $velocityPoints,
            'max_points' => 15,
            'fired' => $velocityPoints > 0,
        ];

        return [
            'score' => min(100, max(0, $total)),
            'signals' => $signals,
        ];
    }

    // -------------------------------------------------------------------------
    // Signal Methods
    // -------------------------------------------------------------------------

    /**
     * Newer accounts carry higher risk.
     * Max: 25 pts.
     */
    private function accountAgeRisk(User $user): int
    {
        $age = $user->created_at;

        if ($age->gt(Carbon::now()->subDay())) {
            return 25; // < 24 hours old
        }

        if ($age->gt(Carbon::now()->subWeek())) {
            return 15; // 1–7 days old
        }

        if ($age->gt(Carbon::now()->subDays(30))) {
            return 5; // 7–30 days old
        }

        return 0; // > 30 days old
    }

    /**
     * Accounts without basic security hardening carry higher risk.
     * Max: 20 pts.
     *
     * Email verification penalty is skipped when email delivery is disabled
     * system-wide — users can never verify what was never sent.
     */
    private function accountSecurityRisk(User $user): int
    {
        $score = 0;

        if (!$user->use_totp) {
            $score += 10;
        }

        // Only penalise unverified email when the email system is actually enabled.
        if ($this->emailSettings->deliveryEnabled() && !$user->hasVerifiedEmail()) {
            $score += 10;
        }

        return $score;
    }

    /**
     * Unknown email domains are higher risk than well-known providers.
     * Max: 15 pts.
     */
    private function emailDomainRisk(User $user): int
    {
        $domain = substr(strrchr($user->email, '@'), 1);

        if (!in_array(strtolower($domain), self::REPUTABLE_DOMAINS, true)) {
            return 15;
        }

        return 0;
    }

    /**
     * Prior payment failures and payer identity mismatches indicate risk.
     * Max: 25 pts.
     */
    private function paymentHistoryRisk(Order $order, User $user): int
    {
        $score = 0;

        $userOrders = Order::where('user_id', $user->id)
            ->whereIn('status', [Order::STATUS_PROCESSED, Order::STATUS_FAILED])
            ->get(['id', 'status']);

        $hasProcessedOrder = $userOrders->where('status', Order::STATUS_PROCESSED)->count() > 0;

        if (!$hasProcessedOrder) {
            $score += 10; // No prior successful payment on record
        }

        $recentFailures = Order::where('user_id', $user->id)
            ->where('status', Order::STATUS_FAILED)
            ->where('created_at', '>=', Carbon::now()->subDays(30))
            ->count();

        if ($recentFailures >= 2) {
            $score += 15;
        } elseif ($recentFailures >= 1) {
            $score += 10;
        }

        // Payer email mismatch: payment was made with a different email address.
        $payerEmail = $order->transaction?->payer_email;
        if ($payerEmail && strtolower($payerEmail) !== strtolower($user->email)) {
            $score += 15;
        }

        return $score;
    }

    /**
     * New and high-value orders are inherently riskier than renewals.
     * Max: 10 pts.
     */
    private function orderSignalRisk(Order $order): int
    {
        $score = 0;

        if ($order->type !== Order::TYPE_REN) {
            $score += 5; // New purchase or upgrade, not a renewal
        }

        $highValueThreshold = (float) config('billing.threat.high_value_threshold', 50.0);
        if ((float) $order->total > $highValueThreshold) {
            $score += 5;
        }

        return $score;
    }

    /**
     * Multiple distinct IP addresses in recent sessions suggest shared/compromised account.
     * Max: 10 pts.
     */
    private function sessionIpRisk(User $user): int
    {
        $distinctIps = $user->sessions()
            ->active()
            ->where('created_at', '>=', Carbon::now()->subDay())
            ->whereNotNull('ip_address')
            ->distinct('ip_address')
            ->count('ip_address');

        if ($distinctIps >= 3) {
            return 10;
        }

        if ($distinctIps >= 2) {
            return 5;
        }

        return 0;
    }

    /**
     * Multiple new/upgrade orders in a short window suggests abuse or bot activity.
     * Max: 15 pts.
     */
    private function orderVelocityRisk(Order $order, User $user): int
    {
        // Only count new purchases and upgrades — renewals are expected to be frequent.
        $recentOrders = Order::where('user_id', $user->id)
            ->whereIn('type', [Order::TYPE_NEW, Order::TYPE_UPG])
            ->where('id', '!=', $order->id)
            ->where('created_at', '>=', Carbon::now()->subDay())
            ->count();

        if ($recentOrders >= 2) {
            return 15;
        }

        if ($recentOrders >= 1) {
            return 10;
        }

        return 0;
    }
}
