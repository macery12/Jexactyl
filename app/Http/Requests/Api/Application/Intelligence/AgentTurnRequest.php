<?php

namespace Everest\Http\Requests\Api\Application\Intelligence;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

/**
 * Opening or resuming an admin agent turn.
 *
 * `ai.read` is the right bar here, and deliberately not a higher one: reaching
 * the assistant is not the same as being able to do anything with it. Every
 * tool the turn goes on to call re-checks its own capability twice on the way
 * in, so an administrator with nothing but `ai.read` gets an assistant that can
 * hold a conversation and call nothing.
 */
class AgentTurnRequest extends ApplicationApiRequest
{
    public function permission(): string
    {
        return AdminRole::AI_READ;
    }

    public function rules(): array
    {
        return [
            'query' => 'required|string|min:1|max:8000',
            'conversation_id' => 'nullable|integer',
        ];
    }
}
