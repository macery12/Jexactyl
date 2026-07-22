<?php

namespace Everest\Http\Controllers\Api\Client\Servers;

use Everest\Models\Server;
use Illuminate\Http\Request;
use Everest\Models\AiMessage;
use Illuminate\Http\JsonResponse;
use Everest\Models\AiConversation;
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
     * Create a new conversation.
     * Sets a 7-day expiry and enforces the per-user unsaved cap.
     */
    public function store(Request $request, Server $server): JsonResponse
    {
        $request->validate([
            'title' => 'nullable|string|max:255',
        ]);

        // Enforce cap: delete oldest unsaved conversations beyond the limit
        $unsavedCount = AiConversation::where('user_id', $request->user()->id)
            ->where('is_saved', false)
            ->count();

        if ($unsavedCount >= AiConversation::MAX_UNSAVED_PER_USER) {
            AiConversation::where('user_id', $request->user()->id)
                ->where('is_saved', false)
                ->orderBy('updated_at')
                ->limit($unsavedCount - AiConversation::MAX_UNSAVED_PER_USER + 1)
                ->get()
                ->each->delete();
        }

        $conversation = AiConversation::create([
            'user_id' => $request->user()->id,
            'server_uuid' => $server->uuid,
            'title' => $request->input('title', 'New conversation'),
            'is_saved' => false,
            'expires_at' => now()->addDays(AiConversation::EXPIRY_DAYS),
        ]);

        return response()->json(['data' => $conversation], 201);
    }

    /**
     * Load messages for a specific conversation.
     */
    public function show(Request $request, Server $server, int $conversationId): JsonResponse
    {
        $conversation = $this->resolveConversation($request, $server, $conversationId);

        $messages = $conversation->messages()->get(['role', 'content', 'created_at']);

        return response()->json([
            'data' => [
                'conversation' => $conversation->only(['id', 'title', 'is_saved', 'expires_at', 'created_at', 'updated_at']),
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
     * Append messages to an existing conversation.
     * Rolls the 7-day expiry forward on each activity (unless saved).
     */
    public function appendMessages(Request $request, Server $server, int $conversationId): JsonResponse
    {
        $conversation = $this->resolveConversation($request, $server, $conversationId);

        $request->validate([
            'messages' => 'required|array|min:1|max:20',
            'messages.*.role' => 'required|in:user,assistant',
            'messages.*.content' => 'required|string|max:8000',
        ]);

        $now = now();
        $rows = array_map(fn ($m) => [
            'conversation_id' => $conversation->id,
            'role' => $m['role'],
            'content' => $m['content'],
            'created_at' => $now,
        ], $request->input('messages'));

        AiMessage::insert($rows);

        // Auto-title from first user message if still default
        if ($conversation->title === 'New conversation') {
            $firstUserContent = collect($request->input('messages'))
                ->firstWhere('role', 'user')['content'] ?? null;
            if ($firstUserContent) {
                $conversation->title = mb_substr($firstUserContent, 0, 80);
            }
        }

        // Rolling expiry: extend 7 days from now on every activity, unless saved
        if (!$conversation->is_saved) {
            $conversation->expires_at = now()->addDays(AiConversation::EXPIRY_DAYS);
        }

        $conversation->save();

        return response()->json(null, 204);
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
