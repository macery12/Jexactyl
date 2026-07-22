<?php

namespace Everest\Http\Controllers\Api\Client\Billing;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Everest\Models\Billing\UserBillingProfile;
use Everest\Http\Controllers\Api\Client\ClientApiController;
use Everest\Http\Requests\Api\Client\Billing\StoreBillingProfileRequest;
use Everest\Http\Requests\Api\Client\Billing\UpdateBillingProfileRequest;

class BillingProfileController extends ClientApiController
{
    public function __construct()
    {
        parent::__construct();
    }

    /**
     * Return the authenticated user's billing profile, or null if none exists.
     */
    public function show(Request $request): JsonResponse
    {
        $profile = $request->user()->billingProfile;

        if (!$profile) {
            return response()->json(null);
        }

        return response()->json($this->transformProfile($profile));
    }

    /**
     * Create a new billing profile for the authenticated user.
     */
    public function store(StoreBillingProfileRequest $request): JsonResponse
    {
        $user = $request->user();

        if ($user->billingProfile()->exists()) {
            return response()->json(['error' => 'A billing profile already exists. Use PUT to update it.'], 409);
        }

        $profile = UserBillingProfile::create([
            'user_id' => $user->id,
            'encrypted_data' => $this->buildDataArray($request),
        ]);

        return response()->json($this->transformProfile($profile), 201);
    }

    /**
     * Update the authenticated user's existing billing profile.
     */
    public function update(UpdateBillingProfileRequest $request): JsonResponse
    {
        $profile = $request->user()->billingProfile;

        if (!$profile) {
            return response()->json(['error' => 'No billing profile found. Use POST to create one.'], 404);
        }

        $profile->update([
            'encrypted_data' => $this->buildDataArray($request),
        ]);

        return response()->json($this->transformProfile($profile->fresh()));
    }

    private function buildDataArray(Request $request): array
    {
        return [
            'first_name'    => $request->input('first_name'),
            'last_name'     => $request->input('last_name'),
            'address_line1' => $request->input('address_line1'),
            'address_line2' => $request->input('address_line2'),
            'city'          => $request->input('city'),
            'state'         => $request->input('state'),
            'postal_code'   => $request->input('postal_code'),
            'country'       => strtoupper($request->input('country')),
            'phone'         => $request->input('phone'),
        ];
    }

    private function transformProfile(UserBillingProfile $profile): array
    {
        $data = $profile->encrypted_data ?? [];

        return [
            'first_name'    => $data['first_name'] ?? null,
            'last_name'     => $data['last_name'] ?? null,
            'address_line1' => $data['address_line1'] ?? null,
            'address_line2' => $data['address_line2'] ?? null,
            'city'          => $data['city'] ?? null,
            'state'         => $data['state'] ?? null,
            'postal_code'   => $data['postal_code'] ?? null,
            'country'       => $data['country'] ?? null,
            'phone'         => $data['phone'] ?? null,
            'updated_at'    => $profile->updated_at?->toIso8601String(),
        ];
    }
}
