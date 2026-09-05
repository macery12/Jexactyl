<?php

namespace Everest\Http\Requests\Api\Client\Tickets;

use Everest\Models\Ticket;
use Everest\Models\TicketMessage;
use Illuminate\Validation\Rule;
use Everest\Http\Requests\Api\Client\ClientApiRequest;

class StoreTicketRequest extends ClientApiRequest
{
    public function rules(): array
    {
        return [
            'title' => Ticket::$validationRules['title'],
            'message' => TicketMessage::$validationRules['message'],
            'server_id' => [
                'nullable',
                'integer',
                Rule::exists('servers', 'id')->where(
                    fn ($query) => $query->where('owner_id', $this->user()->id),
                ),
            ],
        ];
    }
}
