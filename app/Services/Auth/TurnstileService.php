<?php

namespace Everest\Services\Auth;

use GuzzleHttp\Client;
use Everest\Models\Setting;
use Illuminate\Support\Facades\Log;

class TurnstileService
{
    /**
     * Cloudflare Turnstile siteverify endpoint.
     */
    private const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

    /**
     * Verify a Cloudflare Turnstile token.
     *
     * @param string $token The cf-turnstile-response token from the frontend
     * @param string|null $ip Optional IP address for additional verification
     *
     * @return bool True if verification successful, false otherwise
     */
    public function verify(string $token, ?string $ip = null): bool
    {
        // Check if captcha is enabled
        $provider = Setting::get('settings::modules:auth:captcha:provider', 'disabled');

        if ($provider !== 'turnstile') {
            // Captcha is disabled or using a different provider
            return true;
        }

        // Get the secret key from settings
        $secretKey = Setting::get('settings::modules:auth:captcha:secret_key');

        if (empty($secretKey)) {
            Log::warning('Turnstile verification attempted but secret key is not configured');

            return false;
        }

        try {
            $client = new Client();

            $params = [
                'secret' => $secretKey,
                'response' => $token,
            ];

            // Add IP if provided for additional verification
            if ($ip) {
                $params['remoteip'] = $ip;
            }

            $response = $client->post(self::VERIFY_URL, [
                'form_params' => $params,
                'timeout' => 5,
            ]);

            if ($response->getStatusCode() === 200) {
                $result = json_decode($response->getBody(), true);

                if (isset($result['success']) && $result['success'] === true) {
                    return true;
                }

                // Log error codes if verification failed
                if (isset($result['error-codes'])) {
                    Log::warning('Turnstile verification failed', [
                        'error_codes' => $result['error-codes'],
                    ]);
                }
            }
        } catch (\Exception $e) {
            Log::error('Turnstile verification exception', [
                'error' => $e->getMessage(),
            ]);
        }

        return false;
    }

    /**
     * Check if Turnstile captcha is enabled.
     */
    public function isEnabled(): bool
    {
        $provider = Setting::get('settings::modules:auth:captcha:provider', 'disabled');

        return $provider === 'turnstile';
    }

    /**
     * Get the site key for frontend rendering.
     */
    public function getSiteKey(): ?string
    {
        if (!$this->isEnabled()) {
            return null;
        }

        return Setting::get('settings::modules:auth:captcha:site_key');
    }
}
