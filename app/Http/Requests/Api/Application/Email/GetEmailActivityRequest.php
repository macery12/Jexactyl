<?php

namespace Everest\Http\Requests\Api\Application\Email;

use Everest\Models\AdminRole;
use Everest\Models\EmailDelivery;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class GetEmailActivityRequest extends ApplicationApiRequest
{
    protected function prepareForValidation()
    {
        if ($this->has('only_failures')) {
            $value = $this->input('only_failures');

            if (is_string($value)) {
                $normalized = match (strtolower($value)) {
                    'true' => true,
                    'false' => false,
                    default => $value,
                };

                $this->merge(['only_failures' => $normalized]);
            }
        }

        parent::prepareForValidation();
    }

    public function rules(): array
    {
        return [
            'status' => 'nullable|in:' . implode(',', EmailDelivery::statuses()),
            'template_key' => 'nullable|string',
            'recipient' => 'nullable|string',
            'user_id' => 'nullable|integer',
            'only_failures' => 'nullable|boolean',
            'date_from' => 'nullable|date',
            'date_to' => 'nullable|date',
            'sort_by' => 'nullable|in:created_at,status,template_key,recipient,sent_at',
            'sort_dir' => 'nullable|in:asc,desc',
            'per_page' => 'nullable|integer|min:1|max:100',
            'page' => 'nullable|integer|min:1',
        ];
    }

    public function permission(): string
    {
        return AdminRole::EMAIL_READ;
    }
}
