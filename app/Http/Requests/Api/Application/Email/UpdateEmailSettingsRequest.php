<?php

namespace Everest\Http\Requests\Api\Application\Email;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class UpdateEmailSettingsRequest extends ApplicationApiRequest
{
    public function rules(): array
    {
        return [
            'enabled' => 'boolean',
            'transport' => 'nullable|in:resend,smtp',
            'api_key' => 'nullable|string|max:255',
            'clear_api_key' => 'boolean',
            'from_email' => 'nullable|email|max:255',
            'from_name' => 'nullable|string|max:255',
            'reply_to' => 'nullable|email|max:255',
            'smtp_host' => 'nullable|string|max:255',
            'smtp_port' => 'nullable|numeric',
            'smtp_username' => 'nullable|string|max:255',
            'smtp_password' => 'nullable|string|max:255',
            'clear_smtp_password' => 'boolean',
            // Empty string represents no encryption to match UI dropdown default
            'smtp_encryption' => 'nullable|in:,tls,ssl',
            'smtp_from_email' => 'nullable|email|max:255',
            'smtp_from_name' => 'nullable|string|max:255',
            'smtp_reply_to' => 'nullable|email|max:255',
            'resend_plan' => 'nullable|in:free,pro,scale,enterprise',
            'resend_custom_monthly_limit' => 'nullable|integer|min:0',
            'resend_custom_daily_limit' => 'nullable|integer|min:0',
        ];
    }

    public function permission(): string
    {
        return AdminRole::EMAIL_UPDATE;
    }

    /**
     * Normalize the request data for storage.
     *
     * Only includes fields that are actually present in the request.
     * This prevents overwriting existing database values with empty strings
     * when doing partial updates (e.g., toggling enabled only).
     */
    public function normalize(?array $only = null): array
    {
        $data = [];

        if ($this->has('enabled')) {
            $enabledValue = $this->input('enabled', false) ? 'true' : 'false';
            $data['modules:email:enabled'] = $enabledValue;
            // Backward compatibility with previous key
            $data['modules:email:resend:enabled'] = $enabledValue;
        }

        if ($this->has('transport')) {
            $data['modules:email:transport'] = $this->input('transport');
        }

        // Resend fields
        $shouldClearApiKey = $this->boolean('clear_api_key');
        if ($shouldClearApiKey) {
            $data['modules:email:resend:api_key'] = '';
        } elseif ($this->has('api_key')) {
            $data['modules:email:resend:api_key'] = $this->input('api_key', '');
        }

        // The "sender identity" fields (from_email/from_name/reply_to) are exposed
        // in the UI as a single global identity (Overview page) and are the only
        // source for a "from" address — neither the SMTP nor Resend sub-page has
        // its own from field. Mirror them to both transports' keys so the active
        // transport always has a from address regardless of which one is selected.
        if ($this->has('from_email')) {
            $data['modules:email:resend:from_email'] = $this->input('from_email', '');
            $data['modules:email:smtp:from_email'] = $this->input('from_email', '');
        }

        if ($this->has('from_name')) {
            $data['modules:email:resend:from_name'] = $this->input('from_name', '');
            $data['modules:email:smtp:from_name'] = $this->input('from_name', '');
        }

        if ($this->has('reply_to')) {
            $data['modules:email:resend:reply_to'] = $this->input('reply_to', '');
            $data['modules:email:smtp:reply_to'] = $this->input('reply_to', '');
        }

        if ($this->has('resend_plan')) {
            $data['modules:email:resend:plan'] = $this->input('resend_plan');
        }

        if ($this->has('resend_custom_monthly_limit')) {
            $data['modules:email:resend:custom_monthly_limit'] = $this->input('resend_custom_monthly_limit', null);
        }

        if ($this->has('resend_custom_daily_limit')) {
            $data['modules:email:resend:custom_daily_limit'] = $this->input('resend_custom_daily_limit', null);
        }

        // SMTP fields
        if ($this->has('smtp_host')) {
            $data['modules:email:smtp:host'] = $this->input('smtp_host', '');
        }

        if ($this->has('smtp_port')) {
            $data['modules:email:smtp:port'] = $this->input('smtp_port', '');
        }

        if ($this->has('smtp_username')) {
            $data['modules:email:smtp:username'] = $this->input('smtp_username', '');
        }

        $shouldClearSmtpPassword = $this->boolean('clear_smtp_password');
        if ($shouldClearSmtpPassword) {
            $data['modules:email:smtp:password'] = '';
        } elseif ($this->has('smtp_password')) {
            $data['modules:email:smtp:password'] = $this->input('smtp_password', '');
        }

        if ($this->has('smtp_encryption')) {
            $data['modules:email:smtp:encryption'] = $this->input('smtp_encryption', '');
        }

        if ($this->has('smtp_from_email')) {
            $data['modules:email:smtp:from_email'] = $this->input('smtp_from_email', '');
        }

        if ($this->has('smtp_from_name')) {
            $data['modules:email:smtp:from_name'] = $this->input('smtp_from_name', '');
        }

        if ($this->has('smtp_reply_to')) {
            $data['modules:email:smtp:reply_to'] = $this->input('smtp_reply_to', '');
        }

        return $data;
    }
}
