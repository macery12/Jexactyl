<?php

namespace Everest\Http\Controllers\Api\Client;

use Everest\Models\Ticket;
use Everest\Facades\Activity;
use Everest\Models\TicketMessage;
use Illuminate\Http\JsonResponse;
use Everest\Exceptions\DisplayException;
use Everest\Http\Requests\Api\Client\ClientApiRequest;
use Everest\Transformers\Api\Client\TicketTransformer;
use Everest\Http\Requests\Api\Client\Tickets\StoreTicketRequest;
use Everest\Http\Requests\Api\Client\Tickets\StoreTicketMessageRequest;

class TicketController extends ClientApiController
{
    public function __construct()
    {
        parent::__construct();
    }

    /**
     * Returns all the tickets that have been configured for the logged-in
     * user account.
     */
    public function index(ClientApiRequest $request): array
    {
        return $this->fractal->collection($request->user()->tickets)
            ->transformWith(TicketTransformer::class)
            ->toArray();
    }

    /**
     * Stores a new Ticket for the authenticated user's account.
     */
    public function store(StoreTicketRequest $request): array
    {
        $data = $request->validated();
        $enabled = config('modules.tickets.enabled');
        $max_count = (int) (config('modules.tickets.max_count') ?? 0);

        if (!boolval($enabled)) {
            throw new DisplayException('You cannot create a ticket as the module is disabled.');
        }

        if ($request->user()->tickets()->count() >= $max_count) {
            throw new DisplayException("You have reached the ticket count per user of {$max_count}.");
        }

        $ticket = $request->user()->tickets()->create([
            'title' => $data['title'],
        ]);

        TicketMessage::create([
            'ticket_id' => $ticket->id,
            'user_id' => $request->user()->id,
            'message' => $data['message'],
        ]);

        Activity::event('user:ticket.create')
            ->subject($ticket)
            ->log();

        return $this->fractal->item($ticket)
            ->transformWith(TicketTransformer::class)
            ->toArray();
    }

    /**
     * View a ticket and its associated messages.
     */
    public function view(Ticket $ticket, ClientApiRequest $request): array
    {
        if ($request->user()->id !== $ticket->user_id) {
            throw new DisplayException('You do not own this ticket.');
        }

        return $this->fractal->item($ticket)
            ->transformWith(TicketTransformer::class)
            ->toArray();
    }

    /**
     * Add a message to a ticket.
     */
    public function message(Ticket $ticket, StoreTicketMessageRequest $request): array
    {
        $data = $request->validated();
        if ($request->user()->id !== $ticket->user_id) {
            throw new DisplayException('You do not own this ticket.');
        }

        TicketMessage::create([
            'ticket_id' => $ticket->id,
            'user_id' => $request->user()->id,
            'message' => $data['message'],
        ]);

        $ticket->update(['last_reply_at' => now()]);

        return $this->fractal->item($ticket->fresh())
            ->transformWith(TicketTransformer::class)
            ->toArray();
    }

    /**
     * Deletes an Ticket from the user's account.
     */
    public function delete(Ticket $ticket, ClientApiRequest $request): JsonResponse
    {
        if ($request->user()->id !== $ticket->user_id) {
            throw new DisplayException('You do not own this ticket.');
        }

        $ticket->delete();

        TicketMessage::where('ticket_id', $ticket->id)->delete();

        Activity::event('user:ticket.delete')
            ->property('identifier', $ticket->id)
            ->log();

        return new JsonResponse([], JsonResponse::HTTP_NO_CONTENT);
    }
}
