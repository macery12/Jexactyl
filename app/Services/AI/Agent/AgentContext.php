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

    /** @var string[] */
    public array $activeGroups = [];

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
     * The administrator's audited session on a customer's server, once one has
     * been approved. Null on every server turn — the customer's own assistant
     * needs no such thing, it is already on their server.
     */
    public ?AssistBinding $assist = null;

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
     */
    public function toState(): array
    {
        return [
            'messages' => array_map(fn (AiMessage $m) => $m->toArray(), $this->messages),
            'active_groups' => $this->activeGroups,
            'step' => $this->step,
            'repairs' => $this->repairs,
            'questions' => $this->questions,
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
        $context->activeGroups = array_values(array_filter(
            is_array($state['active_groups'] ?? null) ? $state['active_groups'] : [],
            'is_string'
        ));
        $context->step = (int) ($state['step'] ?? 0);
        $context->repairs = (int) ($state['repairs'] ?? 0);
        $context->questions = (int) ($state['questions'] ?? 0);
        $context->addUsage(is_array($state['usage'] ?? null) ? $state['usage'] : []);
        $context->redactions = RedactionMap::fromArray($state['redactions'] ?? null);

        // Restored without its server, and therefore inert: `targetServer()`
        // still returns null and no server-scoped tool can resolve a URI until
        // the caller has re-read the server and re-checked the capability.
        $context->assist = AssistBinding::fromArray($state['assist'] ?? null);

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
