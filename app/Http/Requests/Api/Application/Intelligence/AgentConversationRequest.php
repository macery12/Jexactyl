<?php

namespace Everest\Http\Requests\Api\Application\Intelligence;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

/**
 * Reading, saving or discarding one's own admin assistant transcripts.
 *
 * `ai.read` rather than `ai.update`: this is the administrator's own
 * conversation history, not the panel's AI configuration. Every query is
 * additionally scoped to the acting user, so the capability governs reaching
 * the surface at all rather than reaching anybody else's transcripts.
 */
class AgentConversationRequest extends ApplicationApiRequest
{
    public function permission(): string
    {
        return AdminRole::AI_READ;
    }
}
