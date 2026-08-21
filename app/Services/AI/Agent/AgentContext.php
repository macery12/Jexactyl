<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Data\AiToolCall;
use Everest\Services\AI\Privacy\RedactionMap;
use Everest\Services\AI\Tools\ToolDefinition;

/**
 * Everything one turn needs, and the state that has to survive a suspension.
 *
 * A server turn binds its server from the route it was opened on and nothing in
 * the turn can change it, which is what confines the agent to one server. An
 * admin turn has no server: it acts on the panel through the Application API,
 * authorized by AdminRole capability. A null server is the discriminator between
 * the two surfaces, and `scope()` is the only thing that should read it as such.
 */
class AgentContext
{
    /** @var AiMessage[] */
    public array $messages = [];

    /**
     * Tools this turn is holding on to, in the order they were pinned. A pin
     * survives steps and approvals, and is never silently released. It is a name
     * and nothing more — re-filtered through the live permission check on every
     * step, so holding one grants nothing and outlives no authority.
     *
     * @var string[]
     */
    public array $pinned = [];

    /**
     * Why each pin is held, keyed by tool name.
     *
     * Not decoration. When the budget forces something out, the model is told
     * what went and why it was there, and "you asked for it in step 2" is
     * actionable in a way that a bare name is not.
     *
     * @var array<string, string>
     */
    public array $pinReasons = [];

    /**
     * Secondary search results — offered if there is room, dropped if not. The
     * one evictable tier: a search returns the wanted tool plus neighbours, and
     * treating those neighbours as pins would let one broad query fill the
     * working set with things the turn never used.
     *
     * @var string[]
     */
    public array $retrieved = [];

    /**
     * What the conversation is currently for. A phase is exchanged, not
     * accumulated — unlike the group list it replaces, which meant a turn that
     * browsed billing then opened a customer session still carried the catalogue.
     *
     * Derived state, never authority: `enterPhase()` runs only *after*
     * `AssistAuthorizer` approved the transition, and a restored turn recomputes
     * it from {@see resolvePhase()} rather than trusting what was stored.
     */
    public string $phase = WorkingSet::PHASE_ADMIN;

    public int $step = 0;

    public int $repairs = 0;

    /**
     * Tool-cap truncations already reported this turn, keyed by what was dropped,
     * so a recomputed cap does not write the same warning twelve times. Not
     * carried through {@see toState()}: a resumed turn is a fresh process, and a
     * truncation still happening after an approval is worth saying again.
     *
     * @var string[]
     */
    public array $capWarnings = [];

    /**
     * Questions the model has put to the user this turn. Capped separately from
     * steps: a question costs a whole step plus a full model call, and a model
     * that is unsure will happily spend the turn asking instead of looking.
     */
    public int $questions = 0;

    /**
     * How many times the turn has changed state in a way that makes repeating a
     * call worthwhile again.
     *
     * Part of the no-progress signature: a second `server_status` right after
     * the first is a wasted step, but the same call after a restart is correct.
     * Bumped by successful mutations, phase transitions, working-set changes,
     * and answered questions — the four things that can make an identical
     * call return something different.
     */
    public int $stateVersion = 0;

    /**
     * Signatures of calls already made, in order, for repeat detection.
     *
     * @var string[]
     */
    public array $callSignatures = [];

    /** The current request phase stopped for a human decision. */
    public bool $suspended = false;

    /**
     * The user asked for this turn to stop, and it did.
     *
     * A sibling of `$suspended`, not an exception — cancellation ends a turn
     * cleanly, and the transcript has to stay answerable (an assistant
     * message with unanswered tool calls is one no provider accepts next).
     * Not serialised with the rest of the state: a cancelled turn is over,
     * so there's nothing for a later leg to restore.
     */
    public bool $cancelled = false;

    /**
     * The turn stopped because the authority behind it lapsed, not because the
     * user pressed Stop.
     *
     * Distinguished from `$cancelled` only in wording — both end the turn
     * cleanly at a boundary, but one is the user's own decision and the
     * other is the panel withdrawing a session no longer signed in.
     * Reporting a revocation as "you stopped this" would be a lie the
     * transcript keeps.
     */
    public bool $revoked = false;

    /**
     * Re-derives whether this turn may still act, or null when nothing can
     * revoke it.
     *
     * Only a durable turn carries one. A request-bound turn cannot outlive the
     * session that authorized it — the request *is* the session — so there is
     * nothing to re-check and the closure is absent rather than trivially true.
     *
     * @var (\Closure(): bool)|null
     */
    public ?\Closure $authorityCheck = null;

    /** Tool-call events emitted across every suspension leg of this turn. */
    public int $toolCalls = 0;

    /**
     * What the turn has cost so far, summed across every model call it made. A
     * turn is many calls — one per step, plus repairs — and the caller writes one
     * usage row when the stream closes, so a budget counting rows would not be
     * counting what it is charged for.
     *
     * Carried through {@see toState()}: a turn that suspends and resumes is still
     * one turn, and dropping this would bill only the steps after the approval.
     *
     * @var array{prompt_tokens: int, completion_tokens: int, total_tokens: int}
     */
    public array $usage = ['prompt_tokens' => 0, 'completion_tokens' => 0, 'total_tokens' => 0];

    /**
     * When this turn's wall clock runs out, as a `microtime(true)` stamp. Set
     * once at request-phase entry and shared by queueing, provider calls, tools,
     * batch children and the post-approval loop — a batch holds many dispatches
     * inside one step, so checking only between steps would not enforce it.
     *
     * Null until a turn starts, and absent from {@see toState()}: a resumed turn
     * gets a fresh clock, since waiting for a human is not execution time.
     */
    public ?float $deadline = null;

    /**
     * Durable key of the pending action being resumed. Each dispatched child
     * derives its own key from this value, so retries can be recognized without
     * making two calls in the same batch look identical.
     */
    public ?string $executionKey = null;

    public function idempotencyKeyFor(string $callId): ?string
    {
        return $this->executionKey === null
            ? null
            : hash('sha256', $this->executionKey . ':' . $callId);
    }

    /**
     * The administrator's audited session on a customer's server, once one has
     * been approved. Null on every server turn — the customer's own assistant
     * needs no such thing, it is already on their server.
     */
    public ?AssistBinding $assist = null;

    /** Verified authority attached to the pending action being resumed. */
    public ?AssistGrant $pendingAssistGrant = null;

    /** A grant was expected but failed authentication or state comparison. */
    public bool $pendingAssistAuthorityInvalid = false;

    /**
     * Tokens minted for personal data this conversation has seen, so the same
     * address reads the same way on step nine as it did on step two.
     */
    public RedactionMap $redactions;

    /**
     * The model behind {@see $assist}. Resolved when the binding is made rather
     * than serialised with it, so a suspended turn carries a uuid through the
     * database and re-reads the row — and re-authorizes it — on resume.
     */
    private ?Server $assistServer = null;

    private ?TurnRecorder $recorder = null;

    public function __construct(
        public readonly User $user,
        public readonly ?Server $server,
        public readonly string $turnId,
        public readonly ?int $conversationId = null,
        public readonly ?string $consoleBuffer = null,
    ) {
        $this->redactions = new RedactionMap();
        $this->phase = $this->resolvePhase();
    }

    /**
     * Which toolset and which authorization model this turn runs under.
     *
     * An assist binding does not change this. An administrator diagnosing a
     * customer's server is still on the admin surface — still authorized by
     * AdminRole capability, still writing `scope: admin` audit rows — they have
     * simply been granted a named list of abilities on one server. Reading the
     * binding as a scope change would hand them the customer's whole toolset.
     */
    public function scope(): string
    {
        return $this->server === null
            ? ToolDefinition::SCOPE_ADMIN
            : ToolDefinition::SCOPE_SERVER;
    }

    /**
     * The server a server-scoped tool acts on this turn.
     *
     * For a server turn that is the bound server and nothing can change it. For
     * an admin turn it is whichever server an approved assist session named, or
     * null when none has been.
     */
    public function targetServer(): ?Server
    {
        return $this->server ?? $this->assistServer;
    }

    public function bindAssist(AssistBinding $binding, Server $server): void
    {
        $this->assist = $binding;
        $this->assistServer = $server;

        $this->enterPhase($binding->writable
            ? WorkingSet::PHASE_WRITE_ASSIST
            : WorkingSet::PHASE_READ_ASSIST);
    }

    /**
     * Work out which phase this turn belongs in from what is actually true of it.
     *
     * Recomputed on every resume, for the same reason the assist binding
     * comes back inert: a phase read from stored state would be a claim
     * about authority made by model-derived JSON. Deriving it from the
     * binding the caller has just re-authorized keeps the phase downstream
     * of the decision, not alongside it.
     */
    public function resolvePhase(): string
    {
        if ($this->server !== null) {
            return WorkingSet::PHASE_SERVER;
        }

        if ($this->assist === null || $this->assistServer === null) {
            return WorkingSet::PHASE_ADMIN;
        }

        return $this->assist->writable
            ? WorkingSet::PHASE_WRITE_ASSIST
            : WorkingSet::PHASE_READ_ASSIST;
    }

    /**
     * Move to a new phase, releasing the pins that belonged to the old one.
     *
     * The exchange is the point. Entering a session on a customer's server means
     * the billing lookup three steps ago is no longer what the conversation is
     * about, and carrying it costs a schema slot that the session's own tools
     * need. What is *not* released is anything whose scope survives the move —
     * the target the turn has been working toward, and the shared tools — because
     * a phase change is usually the moment that target finally becomes reachable.
     */
    public function enterPhase(string $phase): void
    {
        if ($this->phase === $phase) {
            return;
        }

        $this->phase = $phase;
        ++$this->stateVersion;

        // Secondary search results are scoped to the task that produced them and
        // are the cheapest thing to re-find.
        $this->retrieved = [];
    }

    /**
     * Hold a tool for later steps.
     *
     * Idempotent, and it keeps the *first* reason: "the user asked for this by
     * name" outranks "a later search happened to return it", and a pin that
     * quietly changed its own justification would make the eviction report lie.
     */
    public function pin(string $name, string $reason): void
    {
        if (in_array($name, $this->pinned, true)) {
            return;
        }

        $this->pinned[] = $name;
        $this->pinReasons[$name] = $reason;
        ++$this->stateVersion;
    }

    /**
     * Release a pin the turn is done with.
     *
     * Called when a tool has run and has no downstream use, when the model drops
     * it explicitly, and when a phase transition supersedes it. Never called to
     * make room — that is what {@see WorkingSetPlanner::propose()} refuses to do.
     */
    public function unpin(string $name): void
    {
        if (!in_array($name, $this->pinned, true)) {
            return;
        }

        $this->pinned = array_values(array_diff($this->pinned, [$name]));
        unset($this->pinReasons[$name]);
        ++$this->stateVersion;
    }

    /**
     * @param string[] $names
     */
    public function setRetrieved(array $names): void
    {
        $this->retrieved = array_values(array_diff($names, $this->pinned));
        ++$this->stateVersion;
    }

    /**
     * @param AiMessage[] $messages
     */
    public function withMessages(array $messages): self
    {
        $this->messages = $messages;

        return $this;
    }

    /**
     * Persist every message pushed from here on.
     *
     * Deliberately attached after any replayed history is loaded, so resuming a
     * suspended turn does not write its earlier half a second time.
     */
    public function withRecorder(?TurnRecorder $recorder): self
    {
        $this->recorder = $recorder;

        return $this;
    }

    /**
     * @param string|null $persistAs stored instead of the model-facing content,
     *                               for messages whose wire form is far larger
     *                               than what the transcript needs
     */
    public function push(AiMessage $message, ?string $persistAs = null): void
    {
        $this->messages[] = $message;

        $this->recorder?->record($this->conversationId, $message, $this->step, $persistAs);
    }

    /**
     * The tool calls from the most recent assistant turn that still have no
     * result. Every provider requires each call to be answered — Anthropic
     * rejects a request whose `tool_use` block has no matching `tool_result` — so
     * calls stranded by a suspension must be closed out on resume.
     *
     * @return AiToolCall[]
     */
    public function unresolvedToolCalls(): array
    {
        $calls = [];

        // Walk back to the last assistant message that asked for tools, taking
        // note of every result seen on the way — those are its answers.
        $answered = [];

        for ($i = count($this->messages) - 1; $i >= 0; --$i) {
            $message = $this->messages[$i];

            if ($message->role === AiMessage::ROLE_TOOL) {
                if ($message->toolCallId !== null) {
                    $answered[$message->toolCallId] = true;
                }

                continue;
            }

            if ($message->role === AiMessage::ROLE_ASSISTANT && $message->toolCalls !== []) {
                $calls = $message->toolCalls;
            }

            break;
        }

        return array_values(array_filter($calls, fn (AiToolCall $call) => !isset($answered[$call->id])));
    }

    /**
     * Serialise the resumable parts of the turn: only the model-visible
     * conversation and the loop counters. The user and server are re-resolved and
     * re-authorized on resume, never trusted from stored state.
     *
     * The assist binding is the one thing here that grants access rather than
     * describing it, so only a uuid and ability names are written — never a
     * resolved model or a capability decision. `fromState()` deliberately leaves
     * the server unbuilt, so a binding cannot outlive the permission that made it.
     *
     * The working set travels as names and the phase not at all; both are
     * re-derived, since an approval can sit on screen for half an hour while an
     * operator narrows a profile or disables a tool.
     */
    public function toState(): array
    {
        return [
            'messages' => array_map(fn (AiMessage $m) => $m->toArray(), $this->messages),
            'pinned' => $this->pinned,
            'pin_reasons' => $this->pinReasons,
            'retrieved' => $this->retrieved,
            'state_version' => $this->stateVersion,
            'call_signatures' => $this->callSignatures,
            'step' => $this->step,
            'repairs' => $this->repairs,
            'questions' => $this->questions,
            'tool_calls' => $this->toolCalls,
            'usage' => $this->usage,
            'console_buffer' => $this->consoleBuffer,
            'assist' => $this->assist?->toArray(),
            'redactions' => $this->redactions->toArray(),
        ];
    }

    public static function fromState(User $user, ?Server $server, string $turnId, ?int $conversationId, array $state): self
    {
        $context = new self(
            $user,
            $server,
            $turnId,
            $conversationId,
            is_string($state['console_buffer'] ?? null) ? $state['console_buffer'] : null,
        );

        $context->messages = array_map(
            fn (array $m) => AiMessage::fromArray($m),
            is_array($state['messages'] ?? null) ? $state['messages'] : []
        );
        $strings = static fn (mixed $value) => array_values(array_filter(
            is_array($value) ? $value : [],
            'is_string'
        ));

        $context->pinned = $strings($state['pinned'] ?? null);
        $context->retrieved = $strings($state['retrieved'] ?? null);
        $context->callSignatures = $strings($state['call_signatures'] ?? null);
        $context->stateVersion = max(0, (int) ($state['state_version'] ?? 0));

        foreach (is_array($state['pin_reasons'] ?? null) ? $state['pin_reasons'] : [] as $name => $reason) {
            if (is_string($name) && is_string($reason) && in_array($name, $context->pinned, true)) {
                $context->pinReasons[$name] = $reason;
            }
        }

        $context->step = (int) ($state['step'] ?? 0);
        $context->repairs = (int) ($state['repairs'] ?? 0);
        $context->questions = (int) ($state['questions'] ?? 0);
        $context->toolCalls = max(0, (int) ($state['tool_calls'] ?? 0));
        $context->addUsage(is_array($state['usage'] ?? null) ? $state['usage'] : []);
        $context->redactions = RedactionMap::fromArray($state['redactions'] ?? null);

        // Restored without its server, and therefore inert: `targetServer()`
        // still returns null and no server-scoped tool can resolve a URI until
        // the caller has re-read the server and re-checked the capability.
        $context->assist = AssistBinding::fromArray($state['assist'] ?? null);

        // Derived from what is true right now, not from what was stored. With the
        // binding still inert this is the admin phase even for a turn that
        // suspended mid-session; `bindAssist()` moves it on once the caller has
        // re-checked the capability and re-attached the server.
        $context->phase = $context->resolvePhase();

        return $context;
    }

    /**
     * Fold one model call's reported usage into the turn's total. Providers
     * disagree about which fields they send, so a missing total is derived rather
     * than left at zero — a turn that was measurably charged should not read as
     * free because the endpoint skipped the addition.
     *
     * @param array<string, mixed> $usage
     */
    public function addUsage(array $usage): void
    {
        $prompt = (int) ($usage['prompt_tokens'] ?? 0);
        $completion = (int) ($usage['completion_tokens'] ?? 0);
        $total = (int) ($usage['total_tokens'] ?? 0);

        $this->usage['prompt_tokens'] += $prompt;
        $this->usage['completion_tokens'] += $completion;
        $this->usage['total_tokens'] += $total ?: $prompt + $completion;
    }

    /**
     * The uuid a restored binding is waiting to be re-attached to, if any.
     */
    public function pendingAssistUuid(): ?string
    {
        return $this->assistServer === null ? $this->assist?->serverUuid : null;
    }
}
