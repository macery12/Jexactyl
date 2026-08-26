<?php

namespace Everest\Http\Controllers\Api\Client\Servers;

use Everest\Models\Server;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Everest\Models\AiConversation;
use Everest\Services\AI\Privacy\RedactionMap;
use Everest\Http\Controllers\Api\Client\ClientApiController;

class AIConversationController extends ClientApiController
{
    /**
     * List all conversations for the authenticated user on this server.
     * Returns newest first, limited to 50.
     */
    public function index(Request $request, Server $server): JsonResponse
    {
        $conversations = AiConversation::where('user_id', $request->user()->id)
            ->where('server_uuid', $server->uuid)
            ->orderByDesc('updated_at')
            ->limit(50)
            ->get(['id', 'title', 'is_saved', 'expires_at', 'created_at', 'updated_at']);

        return response()->json(['data' => $conversations]);
    }

    /**
     * Load messages for a specific conversation.
     */
    public function show(Request $request, Server $server, int $conversationId): JsonResponse
    {
        $conversation = $this->resolveConversation($request, $server, $conversationId);

        // Agent turns store their tool steps alongside the prose. Returning
        // them is what lets a reloaded transcript read the same as the live
        // turn did, instead of implying the assistant answered out of thin air.
        $messages = $conversation->messages()
            ->get(['role', 'content', 'tool_calls', 'tool_call_id', 'tool_name', 'step', 'created_at']);

        return response()->json([
            'data' => [
                'conversation' => $conversation->only(['id', 'title', 'is_saved', 'expires_at', 'created_at', 'updated_at']),
                // What the tokens in this transcript stand for. The values never
                // reached the model; they belong to the person reading, who owns
                // this server and everything on it.
                // `all()` rather than the raw column, which also carries the
                // map's salt — the thing that keeps the provider's tokens from
                // being a stable pseudonym across conversations.
                'redactions' => RedactionMap::fromArray($conversation->redactions)->all(),
                'messages' => $messages,
            ],
        ]);
    }

    /**
     * Delete a conversation (and its messages via cascade).
     */
    public function destroy(Request $request, Server $server, int $conversationId): JsonResponse
    {
        $conversation = $this->resolveConversation($request, $server, $conversationId);

        $conversation->delete();

        return response()->json(null, 204);
    }

    /**
     * Toggle the saved state of a conversation.
     * Saving clears expires_at (permanent). Unsaving sets a fresh 7-day expiry.
     */
    public function toggleSave(Request $request, Server $server, int $conversationId): JsonResponse
    {
        $conversation = $this->resolveConversation($request, $server, $conversationId);

        $nowSaved = !$conversation->is_saved;

        $conversation->update([
            'is_saved' => $nowSaved,
            'expires_at' => $nowSaved ? null : now()->addDays(AiConversation::EXPIRY_DAYS),
        ]);

        return response()->json(['data' => $conversation->only(['id', 'is_saved', 'expires_at'])]);
    }

    /**
     * Resolve a conversation scoped to the authenticated user and the given server.
     * Throws a 404 if it does not exist or does not belong to this user/server, so
     * ownership enforcement is structural rather than a manual per-action check.
     */
    private function resolveConversation(Request $request, Server $server, int $conversationId): AiConversation
    {
        return AiConversation::query()
            ->where('user_id', $request->user()->id)
            ->where('server_uuid', $server->uuid)
            ->findOrFail($conversationId);
    }
}
