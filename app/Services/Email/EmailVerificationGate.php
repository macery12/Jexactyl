<?php

namespace Everest\Services\Email;

use Everest\Models\User;
use Everest\Models\Setting;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Exceptions\HttpResponseException;

class EmailVerificationGate
{
    public const SETTINGS_KEY = 'settings::modules:email:verification_rules';
    public const ERROR_CODE = 'EMAIL_NOT_VERIFIED';
    public const ERROR_MESSAGE = 'Verify your email to continue.';

    public const DEFAULT_RULES = [
        'billing' => [
            'can_view' => true,
            'can_interact' => false,
        ],
        'orders' => [
            'can_view' => true,
            'can_interact' => false,
        ],
        'credentials' => [
            'can_view' => true,
            'can_interact' => true,
        ],
        'tickets' => [
            'can_view' => false,
            'can_interact' => false,
        ],
    ];

    public function __construct(private EmailSettingsReader $settings)
    {
    }

    public function canViewArea(?User $user, string $area): bool
    {
        if (!$this->shouldEnforce($user)) {
            return true;
        }

        $rules = $this->getRules();
        $rule = $rules[$area] ?? ['can_view' => true];

        return (bool) ($rule['can_view'] ?? true);
    }

    public function canInteractArea(?User $user, string $area): bool
    {
        if (!$this->shouldEnforce($user)) {
            return true;
        }

        $rules = $this->getRules();
        $rule = $rules[$area] ?? ['can_interact' => true];

        return (bool) ($rule['can_interact'] ?? true);
    }

    public function assertCanView(?User $user, string $area, ?Request $request = null): void
    {
        if (!$this->canViewArea($user, $area)) {
            throw new HttpResponseException($this->denyResponse($request));
        }
    }

    public function assertCanInteract(?User $user, string $area, ?Request $request = null): void
    {
        if (!$this->canInteractArea($user, $area)) {
            throw new HttpResponseException($this->denyResponse($request));
        }
    }

    public function denyResponse(?Request $request = null): Response|RedirectResponse|JsonResponse
    {
        $payload = [
            'code' => self::ERROR_CODE,
            'message' => self::ERROR_MESSAGE,
        ];

        $request = $request ?? request();

        if ($request->expectsJson() || $request->is('api/*')) {
            return response()->json($payload, Response::HTTP_FORBIDDEN);
        }

        return redirect()->to('/account')->with('warning', $payload['message']);
    }

    public function getRules(): array
    {
        $stored = Setting::get(self::SETTINGS_KEY);

        if (is_string($stored)) {
            $decoded = json_decode($stored, true);
            if (json_last_error() === JSON_ERROR_NONE) {
                $stored = $decoded;
            }
        }

        if (!is_array($stored)) {
            return self::DEFAULT_RULES;
        }

        return $this->normalizeRules($stored);
    }

    public function saveRules(array $rules): array
    {
        $normalized = $this->normalizeRules($rules);
        Setting::set(self::SETTINGS_KEY, json_encode($normalized));

        return $normalized;
    }

    private function normalizeRules(array $rules): array
    {
        $normalized = self::DEFAULT_RULES;

        foreach (self::DEFAULT_RULES as $area => $defaults) {
            $areaRule = $rules[$area] ?? [];
            $normalized[$area] = [
                'can_view' => $this->toBool($areaRule['can_view'] ?? $defaults['can_view']),
                'can_interact' => $this->toBool($areaRule['can_interact'] ?? $defaults['can_interact']),
            ];
        }

        return $normalized;
    }

    private function toBool(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        $value = strtolower((string) $value);

        return in_array($value, ['1', 'true', 'yes', 'on'], true);
    }

    private function shouldEnforce(?User $user): bool
    {
        if (!$user) {
            return false;
        }

        if ($user->hasVerifiedEmail()) {
            return false;
        }

        return $this->settings->deliveryEnabled();
    }
}
