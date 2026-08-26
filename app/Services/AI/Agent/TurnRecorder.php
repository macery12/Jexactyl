<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Models\AiConversation;
use Illuminate\Support\Facades\Log;
use Everest\Services\AI\Privacy\RedactionMap;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Models\AiMessage as MessageRecord;
use Everest\Services\AI\Data\AiMessage as MessageData;

/**
 * Writes a turn into the conversation as it happens.
 *
 * Before this existed the frontend persisted conversations itself, which meant
 * it could only store what it understood — two strings per exchange. Reloading
 * a chat produced a transcript where the agent appeared to have done nothing,
 * because every tool step had been dropped on the floor.
 *
 * Recording server-side also removes the client from the history loop entirely:
 * what the model sees on the next turn is what the panel stored, not whatever a
 * client chose to send back.
 */
class TurnRecorder
{
    /**
     * How many prior messages are replayed into a new turn. Deep enough to
     * follow a conversation, shallow enough that context stays affordable.
     */
    public const HISTORY_DEPTH = 12;

    /**
     * Tool results are stored in the shape the UI renders rather than the one
     * the model reads. The model's copy can be twelve kilobytes of shaped JSON
     * that nothing replays; the card only ever shows the outcome and a line of
     * summary, so that is all that is worth keeping.
     */
    public static function toolDisplay(
        bool $ok,
        string $summary,
        ?string $outcome = null,
        mixed $result = null,
        ?string $batchParentId = null,
        ?int $batchIndex = null,
    ): string {
        return json_encode(array_filter([
            'ok' => $ok,
            'outcome' => $outcome,
            'summary' => $summary,
            'result' => $result,
            'batch_parent_id' => $batchParentId,
            'batch_index' => $batchIndex,
        ], fn ($value) => $value !== null)) ?: '{"ok":false}';
    }

    /**
     * Find or open the conversation this turn belongs to.
     *
     * Returns null only when persistence is impossible, in which case the turn
     * still runs — losing the transcript is worth less than losing the turn.
     */
    public function ensureConversation(User $user, ?Server $server, ?int $conversationId, string $seedTitle): ?AiConversation
    {
        // Admin turns have no server. Matching on the column alone would let an
        // admin conversation be reopened from a server chat whose own server had
        // since been deleted, so the scope is matched explicitly.
        $scope = $server === null ? ToolDefinition::SCOPE_ADMIN : ToolDefinition::SCOPE_SERVER;

        try {
            if ($conversationId !== null) {
                $existing = AiConversation::query()
                    ->where('user_id', $user->id)
                    ->where('scope', $scope)
                    ->where('server_uuid', $server?->uuid)
                    ->find($conversationId);

                if ($existing !== null) {
                    return $existing;
                }
            }

            $this->pruneUnsaved($user);

            return AiConversation::create([
                'user_id' => $user->id,
                'server_uuid' => $server?->uuid,
                'scope' => $scope,
                'title' => $this->title($seedTitle),
                'is_saved' => false,
                'expires_at' => now()->addDays(AiConversation::EXPIRY_DAYS),
            ]);
        } catch (\Throwable $e) {
            Log::warning('Failed to open an AI conversation.', ['exception' => $e::class]);

            return null;
        }
    }

    /**
     * Replay prior turns for the model.
     *
     * Only the prose survives: an old turn's tool results describe a server
     * state that has since moved on, and re-sending them spends context to
     * mislead. What the assistant concluded from them is the part that still
     * holds.
     *
     * @return MessageData[]
     */
    public function loadHistory(?int $conversationId): array
    {
        if ($conversationId === null) {
            return [];
        }

        try {
            $rows = MessageRecord::query()
                ->where('conversation_id', $conversationId)
                ->whereIn('role', [MessageRecord::ROLE_USER, MessageRecord::ROLE_ASSISTANT])
                ->whereNotNull('content')
                ->where('content', '!=', '')
                ->orderByDesc('id')
                ->limit(self::HISTORY_DEPTH)
                ->get(['role', 'content'])
                ->reverse();
        } catch (\Throwable $e) {
            Log::warning('Failed to load AI conversation history.', ['exception' => $e::class]);

            return [];
        }

        return $rows
            ->map(fn (MessageRecord $row) => new MessageData($row->role, (string) $row->content))
            ->values()
            ->all();
    }

    /**
     * Append one message to the conversation.
     *
     * Never throws: a turn that is working must not be killed by a failure to
     * write its own history.
     */
    public function record(?int $conversationId, MessageData $message, int $step, ?string $persistAs = null): void
    {
        if ($conversationId === null) {
            return;
        }

        $content = $persistAs ?? $message->content;

        // A pure tool-call assistant turn has no prose. It is still worth a row
        // because it carries the arguments the tool rows render from.
        if ($content === null && $message->toolCalls === []) {
            return;
        }

        try {
            MessageRecord::create([
                'conversation_id' => $conversationId,
                'role' => $message->role,
                // The column is NOT NULL and a pure tool-call turn has no
                // prose; the empty string is excluded from replayed history
                // just as a null would be.
                'content' => $content ?? '',
                'tool_calls' => $message->toolCalls === []
                    ? null
                    : array_map(fn ($call) => [
                        'id' => $call->id,
                        'name' => $call->name,
                        'arguments' => $call->arguments,
                        'batch_parent_id' => $call->batchParentId,
                        'batch_index' => $call->batchIndex,
                    ], $message->toolCalls),
                'tool_call_id' => $message->toolCallId,
                'tool_name' => $message->toolName,
                'step' => $step,
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('Failed to record an AI message.', ['exception' => $e::class]);
        }
    }

    /**
     * Roll the conversation's expiry forward, the same way a manual append does,
     * and store any redaction tokens the turn minted.
     *
     * The map is folded into what is already stored rather than replacing it:
     * this turn's context started from the stored map, but a turn that resumed
     * from a suspension carries only what its own state held, and overwriting
     * would lose every token minted before the pause.
     */
    public function touch(?AiConversation $conversation, ?AgentContext $context = null): bool
    {
        if ($conversation === null) {
            return true;
        }

        try {
            if (!$conversation->is_saved) {
                $conversation->expires_at = now()->addDays(AiConversation::EXPIRY_DAYS);
            }

            if ($context !== null && !$context->redactions->isEmpty()) {
                $merged = RedactionMap::fromArray($conversation->redactions);
                $merged->merge($context->redactions);
                $conversation->redactions = $merged->toArray();
            }

            // Only ever written, never cleared from here: a turn that ran without
            // resolving the binding (the capability was withdrawn, the server was
            // deleted) has already refused the access, and blanking the column on
            // its way past would hide from the administrator that a session was
            // ever open.
            if ($context?->assist !== null) {
                $conversation->assist = $context->assist->toArray();
            }

            $conversation->save();

            return true;
        } catch (\Throwable $e) {
            Log::warning('Failed to touch an AI conversation.', ['exception' => $e::class]);

            return false;
        }
    }

    /**
     * The tokens a conversation has already minted, so a resumed or continued
     * turn keeps calling the same person the same thing.
     */
    public function loadRedactions(?AiConversation $conversation): RedactionMap
    {
        return RedactionMap::fromArray($conversation?->redactions);
    }

    /**
     * The assist session this conversation had open, still detached from its
     * server. The caller re-reads the server and re-checks the capability before
     * it grants anything.
     */
    public function loadAssist(?AiConversation $conversation): ?AssistBinding
    {
        return AssistBinding::fromArray($conversation?->assist);
    }

    /**
     * Keep the per-user unsaved conversation cap, dropping the stalest first.
     */
    private function pruneUnsaved(User $user): void
    {
        $unsaved = AiConversation::where('user_id', $user->id)->where('is_saved', false)->count();

        if ($unsaved < AiConversation::MAX_UNSAVED_PER_USER) {
            return;
        }

        AiConversation::where('user_id', $user->id)
            ->where('is_saved', false)
            ->orderBy('updated_at')
            ->limit($unsaved - AiConversation::MAX_UNSAVED_PER_USER + 1)
            ->get()
            ->each->delete();
    }

    private function title(string $seed): string
    {
        $clean = trim(preg_replace('/\s+/', ' ', $seed) ?? '');

        return $clean === '' ? 'New conversation' : mb_substr($clean, 0, 80);
    }
}
