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
 * For a server turn the server is bound here from the route the turn was opened
 * on. Nothing in the turn can change it — that binding is what confines the
 * agent to a single server regardless of what the model asks for.
 *
 * An admin turn has no server: it acts on the panel itself through the
 * Application API, where authorization is by AdminRole capability rather than
 * by subuser permission on a subject. A null server is therefore the
 * discriminator between the two surfaces, and `scope()` is the only thing that
 * should read it as such.
 */
class AgentContext
{
    /** @var AiMessage[] */
    public array $messages = [];

    /**
     * Tools this turn is holding on to, in the order they were pinned.
     *
     * A pin survives steps and survives an approval. It is set by the user naming
     * a tool, by a search selecting one, by `load_tools`, and by a pinned tool
     * needing a gateway — and it is *not* silently released, which is the whole
     * difference from the cumulative groups this replaced. A pin is a name and
     * nothing more: it is re-filtered through the live permission check on every
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
     * Secondary search results — offered if there is room, dropped without
     * ceremony if there is not.
     *
     * The one evictable tier. A search returns the tool the model wanted plus a
     * few neighbours; the neighbours are a suggestion rather than a commitment,
     * and treating them as pins would let one broad query fill the working set
     * with things the turn never used.
     *
     * @var string[]
     */
    public array $retrieved = [];

    /**
     * What the conversation is currently for.
     *
     * Replaces the cumulative group list, and behaves the opposite way: groups
     * only ever grew, so a turn that browsed billing and then opened a session on
     * a customer's server was still carrying the product catalogue. A phase is
     * exchanged, not accumulated.
     *
     * Derived state, never authority. `enterPhase()` is called *after*
     * `AssistAuthorizer` has recorded and approved the transition, and a restored
     * turn recomputes it rather than trusting what was stored. Set from
     * {@see resolvePhase()} in the constructor, so it is never wrong for a turn
     * that has not started yet.
     */
    public string $phase = WorkingSet::PHASE_ADMIN;

    public int $step = 0;

    public int $repairs = 0;

    /**
     * Tool-cap truncations already reported this turn, keyed by what was
     * dropped.
     *
     * The cap is recomputed every step, so an over-cap turn would otherwise
     * write the same warning twelve times. Deliberately not carried through
     * {@see toState()}: a resumed turn is a fresh process with a fresh log, and
     * a truncation that is still happening after an approval is worth saying
     * again.
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
     * Part of the no-progress signature: a second `server_status` right after the
     * first is a wasted step, but the same call after a restart is the correct
     * thing to do. Bumped by successful mutations, phase transitions, working-set
     * changes and answered questions — the four things that can make an identical
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
     * A sibling of `$suspended` rather than an exception, because cancellation
     * ends a turn cleanly: whatever ran, ran and reported, and the transcript
     * has to stay answerable — an assistant message whose tool calls were never
     * answered is one no provider will accept on the next turn. Unwinding
     * through the loop would leave exactly that. Deliberately not serialised
     * with the rest of the state: a cancelled turn is over, so there is nothing
     * for a later leg to restore.
     */
    public bool $cancelled = false;

    /**
     * The turn stopped because the authority behind it lapsed, not because the
     * user pressed Stop.
     *
     * Distinguished from `$cancelled` only in what it is called, because the two
     * want identical handling and opposite wording: both end the turn cleanly at
     * a boundary, and one of them is the user's own decision while the other is
     * the panel withdrawing a session that is no longer signed in. Reporting a
     * revocation as "you stopped this" would be a lie the transcript keeps.
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
     * What the turn has cost so far, summed across every model call it made.
     *
     * A turn is many calls — one per step, plus repairs — and each reports its
     * own usage. Accumulating here rather than logging per call is what makes a
     * turn's cost answerable at all: the caller writes one usage row when the
     * stream closes, and a token budget that counts rows would otherwise be
     * counting turns while being charged for calls.
     *
     * Carried through {@see toState()} because a turn that suspends for an
     * approval and resumes is still one turn. Dropping it there would bill the
     * operator for the steps after the approval and nothing before it.
     *
     * @var array{prompt_tokens: int, completion_tokens: int, total_tokens: int}
     */
    public array $usage = ['prompt_tokens' => 0, 'completion_tokens' => 0, 'total_tokens' => 0];

    /**
     * When this turn's wall clock runs out, as a `microtime(true)` stamp.
     *
     * Established once at request-phase entry and shared by queueing, provider
     * calls, ordinary tools, batch children, and the loop that follows an
     * approved action. A batch can hold many dispatches inside one model step,
     * so checking only between steps would not enforce the configured limit.
     *
     * Null until a turn starts, and deliberately absent from {@see toState()} —
     * a resumed turn is a fresh request phase with a fresh clock. Time spent
     * waiting for a human decision is not execution time and must not consume
     * the allowance for the approved work.
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
     * Recomputed rather than restored, on every resume, for the same reason the
     * assist binding comes back inert: a phase read from stored state would be a
     * claim about authority made by the state blob, and the state blob is
     * model-derived JSON. Deriving it from the binding the caller has just
     * re-authorized keeps the phase downstream of the decision rather than
     * alongside it.
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
     * result.
     *
     * Every provider requires each tool call to be answered before the
     * conversation can continue — Anthropic rejects the request outright if a
     * `tool_use` block has no matching `tool_result`. A turn that suspends
     * partway through a batch of parallel calls leaves exactly that gap: the
     * calls after the one awaiting approval never ran, so on resume they have
     * to be closed out rather than silently dropped.
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
     * Serialise the resumable parts of the turn.
     *
     * Only the model-visible conversation and the loop counters: the user and
     * server are re-resolved and re-authorized on resume rather than trusted
     * from stored state.
     *
     * The assist binding is the one thing here that grants access rather than
     * describing it, so what is written is a uuid and a list of ability names —
     * never a resolved model, never a capability decision. `fromState()`
     * deliberately does not rebuild the server: the caller re-reads the row and
     * re-checks the administrator's capability before calling `bindAssist()`,
     * which is why a binding cannot outlive the permission that created it.
     *
     * The working set travels as names only, and the phase does not travel at
     * all. Both are re-derived on resume: a pin is re-filtered through the live
     * permission check before it can be offered, and the phase is recomputed from
     * the binding the caller has just re-authorized. An approval can sit on
     * screen for half an hour, and in that time an operator can narrow an Access
     * Profile or disable a tool — so what comes back has to be a request to
     * reconsider, not a decision already made.
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
     * Fold one model call's reported usage into the turn's total.
     *
     * Providers disagree about which fields they send — some report a total,
     * some only the two halves, some (a streamed OpenAI-compatible call with
     * usage disabled) nothing at all. A missing total is derived rather than
     * left at zero, since a turn that was measurably charged should not read as
     * free just because the endpoint declined to do the addition.
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
