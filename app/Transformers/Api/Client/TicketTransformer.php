<?php

namespace Everest\Transformers\Api\Client;

use Everest\Models\Ticket;
use League\Fractal\Resource\Collection;
use Everest\Transformers\Api\Transformer;
use League\Fractal\Resource\NullResource;

class TicketTransformer extends Transformer
{
    /**
     * List of resources that can be included.
     */
    protected array $availableIncludes = ['messages'];

    public function getResourceName(): string
    {
        return Ticket::RESOURCE_NAME;
    }

    /**
     * Return's a user's ticket in an API response format.
     */
    public function transform(Ticket $model): array
    {
        return [
            'id' => $model->id,
            'title' => $model->title,
            'status' => $model->status,
            'priority' => $model->priority,
            'server_id' => $model->server_id,
            'server' => $model->server === null ? null : [
                'id' => $model->server->id,
                'identifier' => $model->server->uuidShort,
                'name' => $model->server->name,
            ],
            'last_reply_at' => $model->last_reply_at?->toIso8601String(),
            'created_at' => $model->created_at->toIso8601String(),
            'updated_at' => $model->updated_at?->toIso8601String(),
        ];
    }

    /**
     * Return the messages associated with this ticket, excluding internal admin notes.
     */
    public function includeMessages(Ticket $ticket): Collection|NullResource
    {
        return $this->collection(
            $ticket->messages()->where('internal_note', false)->get(),
            new TicketMessageTransformer()
        );
    }
}
