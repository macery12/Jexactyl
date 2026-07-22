<?php

namespace Everest\Http\Controllers\Api\Application;

use Everest\Models\User;
use Everest\Models\Setting;
use Everest\Facades\Activity;
use Everest\Models\EmailQuota;
use Everest\Models\EmailDelivery;
use Illuminate\Http\JsonResponse;
use Everest\Services\Email\EmailResult;
use Everest\Services\Email\EmailManager;
use Everest\Services\Email\EmailRedactor;
use Everest\Models\EmailNotificationSetting;
use Everest\Services\Email\EmailPolicyService;
use Everest\Services\Email\EmailSettingsReader;
use Everest\Services\Email\EmailVerificationGate;
use Everest\Exceptions\Service\Email\ResendException;
use Everest\Http\Requests\Api\Application\Email\SendTestEmailRequest;
use Everest\Http\Requests\Api\Application\Email\GetEmailQuotaInfoRequest;
use Everest\Http\Requests\Api\Application\Email\GetUserEmailQuotaRequest;
use Everest\Http\Requests\Api\Application\Email\TestEmailConnectionRequest;
use Everest\Http\Requests\Api\Application\Email\UpdateEmailSettingsRequest;
use Everest\Http\Requests\Api\Application\Email\UpdateUserEmailQuotaRequest;
use Everest\Http\Requests\Api\Application\Email\UpdateVerificationRulesRequest;
use Everest\Http\Requests\Api\Application\Email\GetEmailNotificationSettingsRequest;
use Everest\Http\Requests\Api\Application\Email\UpdateEmailNotificationSettingRequest;

class EmailController extends ApplicationApiController
{
    private const ACTION_SEND_TEST = 'send_test';
    private const ACTION_CONNECTION_TEST = 'connection_test';

    /**
     * EmailController constructor.
     */
    public function __construct(
        private EmailManager $emailManager,
        private EmailVerificationGate $verificationGate,
        private EmailSettingsReader $settings,
        private EmailPolicyService $policy,
    ) {
        parent::__construct();
    }

    /**
     * Get current email settings from database.
     */
    public function getSettings(GetEmailNotificationSettingsRequest $request): JsonResponse
    {
        return response()->json($this->settings->adminSettings());
    }

    public function getVerificationRules(GetEmailNotificationSettingsRequest $request): JsonResponse
    {
        return response()->json($this->verificationGate->getRules());
    }

    public function updateVerificationRules(UpdateVerificationRulesRequest $request): JsonResponse
    {
        $rules = $this->verificationGate->saveRules($request->normalizedRules());

        Activity::event('admin:email:verification-rules:update')
            ->property('rules', $rules)
            ->description('Email verification rules were updated')
            ->log();

        return response()->json($rules);
    }

    /**
     * Update the email transport settings (SMTP or Resend).
     *
     * @throws \Throwable
     */
    public function updateSettings(UpdateEmailSettingsRequest $request): JsonResponse
    {
        $shouldClearApiKey = $request->boolean('clear_api_key');
        $shouldClearSmtpPassword = $request->boolean('clear_smtp_password');

        foreach ($request->normalize() as $key => $value) {
            // Avoid overwriting an existing key with empty string unless explicitly clearing.
            if ($key === 'modules:email:resend:api_key' && empty($value) && !$shouldClearApiKey) {
                continue;
            }
            if ($key === 'modules:email:smtp:password' && empty($value) && !$shouldClearSmtpPassword) {
                continue;
            }

            Setting::set('settings::' . $key, $value);
        }

        $activitySettings = $request->all();
        $activitySettings = EmailRedactor::redactExactKeys($activitySettings, ['api_key', 'smtp_password']);
        if (array_key_exists('clear_api_key', $activitySettings)) {
            $activitySettings['clear_api_key'] = (bool) $activitySettings['clear_api_key'];
        }
        if (array_key_exists('clear_smtp_password', $activitySettings)) {
            $activitySettings['clear_smtp_password'] = (bool) $activitySettings['clear_smtp_password'];
        }

        Activity::event('admin:email:update')
            ->property('settings', $activitySettings)
            ->description('Email settings were updated')
            ->log();

        return response()->json($this->settings->adminSettings());
    }

    /**
     * Send a real delivery test email to a specific recipient.
     */
    public function sendTest(SendTestEmailRequest $request): JsonResponse
    {
        $recipient = $request->input('to');

        if (!$this->policy->isDeliveryEnabled()) {
            return $this->formatEmailResult(
                EmailResult::skipped('disabled'),
                $this->settings->transport(),
                self::ACTION_SEND_TEST,
                $recipient
            );
        }

        if ($this->policy->isBlockedRecipient($recipient)) {
            return $this->formatEmailResult(
                EmailResult::blocked('blocked_invalid_recipient'),
                $this->settings->transport(),
                self::ACTION_SEND_TEST,
                $recipient
            );
        }

        try {
            $result = $this->emailManager->sendCustom(
                to: $recipient,
                subject: 'Email Delivery Test',
                html: '<h1>Email Delivery Test</h1><p>This is a real delivery test message from the email system. If you received it, the active email transport can deliver mail end-to-end.</p>'
            );

            Activity::event('admin:email:test')
                ->property('to', $recipient)
                ->property('message_id', $result->messageId)
                ->description($result->success ? 'Delivery test email sent successfully' : 'Delivery test email failed')
                ->log();

            return $this->formatEmailResult($result, EmailManager::getTransport(), self::ACTION_SEND_TEST, $recipient);
        } catch (ResendException $e) {
            return $this->formatExceptionError($e, EmailManager::getTransport(), self::ACTION_SEND_TEST, $recipient);
        }
    }

    /**
     * Test SMTP connectivity without sending user-facing notifications.
     */
    public function testSmtpConnection(TestEmailConnectionRequest $request): JsonResponse
    {
        $result = $this->emailManager->testTransport('smtp');

        return $this->formatEmailResult($result, 'smtp', self::ACTION_CONNECTION_TEST);
    }

    /**
     * Test Resend connectivity without sending user-facing notifications.
     */
    public function testResendConnection(TestEmailConnectionRequest $request): JsonResponse
    {
        $result = $this->emailManager->testTransport('resend');

        return $this->formatEmailResult($result, 'resend', self::ACTION_CONNECTION_TEST);
    }

    /**
     * Get all email notification settings.
     */
    public function getNotificationSettings(GetEmailNotificationSettingsRequest $request): JsonResponse
    {
        $settings = EmailNotificationSetting::orderBy('category')
            ->orderBy('name')
            ->get()
            ->groupBy('category');

        return response()->json([
            'categories' => $settings,
        ]);
    }

    /**
     * Update a specific email notification setting.
     */
    public function updateNotificationSetting(UpdateEmailNotificationSettingRequest $request, string $id): JsonResponse
    {
        $setting = EmailNotificationSetting::findOrFail($id);
        $enabled = $request->boolean('enabled');

        $setting->enabled = $enabled;
        $setting->save();

        Activity::event('admin:email:notifications:toggle')
            ->property('template_key', $setting->template_key)
            ->property('enabled', $enabled)
            ->description("Email notification '{$setting->name}' " . ($enabled ? 'enabled' : 'disabled'))
            ->log();

        return response()->json([
            'success' => true,
            'setting' => $setting,
        ]);
    }

    /**
     * Get email quota information.
     */
    public function getQuotaInfo(GetEmailQuotaInfoRequest $request): JsonResponse
    {
        // Get aggregate quota stats across all users
        $totalQuotas = EmailQuota::selectRaw('
            plan,
            COUNT(*) as user_count,
            SUM(monthly_sent) as total_monthly_sent,
            SUM(daily_sent) as total_daily_sent,
            SUM(monthly_overage) as total_overage
        ')
            ->groupBy('plan')
            ->get();

        return response()->json([
            'quotas_by_plan' => $totalQuotas,
        ]);
    }

    /**
     * Get email quota for a specific user.
     */
    public function getUserQuota(GetUserEmailQuotaRequest $request, int $userId): JsonResponse
    {
        $user = User::findOrFail($userId);
        $quota = EmailQuota::where('user_id', $userId)->first();

        if (!$quota) {
            return response()->json([
                'user' => [
                    'id' => $user->id,
                    'email' => $user->email,
                    'username' => $user->username,
                ],
                'quota' => null,
            ]);
        }

        $remaining = $quota->getRemainingQuota();

        return response()->json([
            'user' => [
                'id' => $user->id,
                'email' => $user->email,
                'username' => $user->username,
            ],
            'quota' => [
                'plan' => $quota->plan,
                'monthly_limit' => $quota->monthly_limit,
                'daily_limit' => $quota->daily_limit,
                'monthly_sent' => $quota->monthly_sent,
                'daily_sent' => $quota->daily_sent,
                'monthly_overage' => $quota->monthly_overage,
                'remaining' => $remaining,
                'month_reset_at' => $quota->month_reset_at,
                'day_reset_at' => $quota->day_reset_at,
            ],
        ]);
    }

    /**
     * Update user email quota plan.
     */
    public function updateUserQuota(UpdateUserEmailQuotaRequest $request, int $userId): JsonResponse
    {
        $plan = $request->input('plan', 'free');

        $quota = EmailQuota::getOrCreateForUser($userId, $plan);

        $planConfig = EmailQuota::PLANS[$plan];
        $quota->plan = $plan;
        $quota->monthly_limit = $planConfig['monthly_limit'];
        $quota->daily_limit = $planConfig['daily_limit'];
        $quota->save();

        Activity::event('admin:email:quota:update')
            ->property('user_id', $userId)
            ->property('plan', $plan)
            ->description("Updated email quota plan for user {$userId} to {$plan}")
            ->log();

        return response()->json([
            'success' => true,
            'quota' => $quota,
        ]);
    }

    /**
     * Normalize an EmailResult into a structured JSON response.
     */
    private function formatEmailResult(EmailResult $result, string $transport, string $context, ?string $recipient = null): JsonResponse
    {
        if ($result->success) {
            $payload = [
                'success' => true,
                'action' => $context,
                'transport' => $transport,
                'provider' => $transport,
                'message_id' => $result->messageId,
                'recipient' => $recipient,
                'status' => $result->status ?? EmailDelivery::STATUS_SENT,
                'reason' => $result->reason,
            ];

            if ($this->isTestAction($context)) {
                $payload['tested_at'] = now()->toIso8601String();
                $payload['test_type'] = $this->getTestType($context);
            }
            if ($context === self::ACTION_SEND_TEST) {
                $payload['sent_at'] = now()->toIso8601String();
            }

            return response()->json($payload);
        }

        $status = $result->statusCode ?? ($result->status === 'skipped' ? 422 : 500);

        return response()->json([
            'success' => false,
            'action' => $context,
            'transport' => $transport,
            'provider' => $transport,
            'recipient' => $recipient,
            'status' => $result->status ?? EmailDelivery::STATUS_FAILED,
            'reason' => $result->reason,
            'error' => [
                'code' => $this->deriveErrorCode($transport, $result, $context),
                'status' => $status,
                'message' => $result->error ?? $result->reason ?? 'Email action failed',
            ],
        ] + ($this->isTestAction($context) ? [
            'tested_at' => now()->toIso8601String(),
            'test_type' => $this->getTestType($context),
        ] : []), $status);
    }

    private function formatExceptionError(
        \Throwable $e,
        string $transport,
        string $context = self::ACTION_SEND_TEST,
        ?string $recipient = null,
    ): JsonResponse {
        report($e);

        $message = $context === self::ACTION_CONNECTION_TEST
            ? 'Unexpected email provider error during the connection check. Review the provider settings or server logs.'
            : 'Unexpected email provider error during the delivery test. Review the provider settings or server logs.';

        return response()->json([
            'success' => false,
            'action' => $context,
            'transport' => $transport,
            'provider' => $transport,
            'recipient' => $recipient,
            'status' => EmailDelivery::STATUS_FAILED,
            'error' => [
                'code' => strtoupper($transport) . '_UNEXPECTED_ERROR',
                'status' => 500,
                'message' => $message,
            ],
        ] + ($context !== null && $this->isTestAction($context) ? [
            'tested_at' => now()->toIso8601String(),
            'test_type' => $this->getTestType($context),
        ] : []), 500);
    }

    private function deriveErrorCode(string $transport, EmailResult $result, string $context): string
    {
        if ($result->status === 'skipped' || $result->reason === 'disabled') {
            return 'EMAIL_DISABLED';
        }

        if ($result->retryable === false) {
            return strtoupper($transport) . '_CONFIG_INVALID';
        }

        if ($result->statusCode && $result->statusCode >= 400 && $result->statusCode < 500) {
            return strtoupper($transport) . '_AUTH_FAILED';
        }

        return strtoupper($transport) . '_' . strtoupper($context) . '_FAILED';
    }

    private function isTestAction(string $context): bool
    {
        return in_array($context, [self::ACTION_SEND_TEST, self::ACTION_CONNECTION_TEST], true);
    }

    private function getTestType(string $context): string
    {
        return $context === self::ACTION_CONNECTION_TEST ? 'connection' : 'delivery';
    }
}
