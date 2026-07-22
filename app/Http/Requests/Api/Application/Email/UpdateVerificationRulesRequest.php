<?php

namespace Everest\Http\Requests\Api\Application\Email;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class UpdateVerificationRulesRequest extends ApplicationApiRequest
{
    public function rules(): array
    {
        return [
            'billing.can_view' => 'required|boolean',
            'billing.can_interact' => 'required|boolean',
            'orders.can_view' => 'required|boolean',
            'orders.can_interact' => 'required|boolean',
            'credentials.can_view' => 'required|boolean',
            'credentials.can_interact' => 'required|boolean',
            'tickets.can_view' => 'required|boolean',
            'tickets.can_interact' => 'required|boolean',
        ];
    }

    public function permission(): string
    {
        return AdminRole::EMAIL_UPDATE;
    }

    public function normalizedRules(): array
    {
        $areas = ['billing', 'orders', 'credentials', 'tickets'];
        $rules = [];

        foreach ($areas as $area) {
            $rules[$area] = [
                'can_view' => (bool) $this->boolean("{$area}.can_view"),
                'can_interact' => (bool) $this->boolean("{$area}.can_interact"),
            ];
        }

        return $rules;
    }
}
