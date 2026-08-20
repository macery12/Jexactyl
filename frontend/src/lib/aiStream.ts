import { readCsrfToken } from '@/lib/globals';

// SSE client for the panel's agent endpoint.
//
// It once served two shapes: the advisory chat's `data: {"content": "..."}` and
// the agent's tagged union. The chat reader is gone with chat mode, but the
// agent still keeps `content` on its text event — that was never only about
// back-compatibility, it is also what lets a panel running slightly behind its
// backend render a readable answer instead of nothing.
//
// axios cannot consume incremental bodies, so this uses fetch + a reader.

export type AiRisk = 'safe' | 'write' | 'destructive';

/**
 * What the approval card shows in place of the raw arguments, for the tools
 * whose arguments do not read as themselves. Built by `ApprovalPreview`, and
 * rebuildable from the stored call, so an approval reopened later renders the
 * same thing it did live.
 */
export interface AiDiffPreview {
    kind: 'diff';
    file: string | null;
    original: string;
    updated: string;
}

/** The customer's server an admin is being asked to open a session on. */
export interface AiServerPreview {
    kind: 'server';
    name: string;
    owner: string | null;
    identifier: string;
}

/** Live server row a destructive assist action must be confirmed against. */
export interface AiConfirmationPreview {
    kind: 'confirmation';
    name: string;
    identifier: string;
}

/**
 * The calls a batch will make, once approved.
 *
 * The one preview that is not optional in spirit: a batch's arguments *are* tool
 * calls, and rendered as arguments they come out as nested JSON — which is the
 * card nobody reads, and giving that back would undo the point of approving
 * twenty changes once instead of twenty times.
 */
export interface AiBatchPreview {
    kind: 'batch';
    /**
     * The model's own description of what it is about to do. Displayed as such
     * and never as the evidence — a batch approved on the strength of a sentence
     * its subject wrote is not a reviewed batch.
     */
    summary: string;
    count: number;
    /**
     * How many children are above SAFE, and therefore how many the card must
     * see opened before it will enable approval. Resolved server-side against
     * the live tool policy, so a tool hardened while the card sat on screen
     * raises the bar rather than being reviewed under the old one.
     */
    requires_review: number;
    calls: { tool: string; arguments: Record<string, unknown>; risk: AiRisk }[];
}

export type AiApprovalPreview = AiDiffPreview | AiServerPreview | AiConfirmationPreview | AiBatchPreview;

export type AgentEvent =
    | { type: 'conversation'; id: number; title: string }
    | {
          /**
           * The turn is waiting for an inference slot.
           *
           * `ticket` is the place in line, and its presence is what
           * distinguishes the two cases: with one, the turn has *not* started
           * and the client must present the ticket again to keep its position;
           * without one the frame is informational. The panel deliberately does
           * not hold the request open while it waits — that cost one PHP worker
           * per waiter — so coming back is the client's job.
           */
          type: 'queued';
          position: number;
          ahead: number;
          eta_seconds: number;
          ticket?: string;
          retry_after_ms?: number;
      }
    | { type: 'text'; content: string }
    | { type: 'reasoning'; content: string }
    | { type: 'tool_pending'; id: string; tool: string }
    | {
          type: 'tool_call';
          id: string;
          tool: string;
          arguments: Record<string, unknown>;
          risk: AiRisk;
          batch_parent_id?: string;
          batch_index?: number;
      }
    | {
          type: 'tool_result';
          id: string;
          tool: string;
          ok: boolean;
          outcome?: 'success' | 'partial' | 'failed';
          summary: string;
          /** The shaped payload the model was given. Live only — never replayed from storage. */
          result?: unknown;
          duration_ms?: number;
          batch_parent_id?: string;
          batch_index?: number;
      }
    | {
          type: 'approval_required';
          turn_id: string;
          tool: string;
          arguments: Record<string, unknown>;
          risk: AiRisk;
          preview?: AiApprovalPreview;
      }
    | {
          type: 'question_required';
          turn_id: string;
          question: string;
          options: { label: string; description?: string }[];
          allow_other: boolean;
      }
    | {
          /**
           * Personal data the panel kept out of the request, and what it really
           * was. Runs the opposite way to every other event: the model got the
           * token, the browser gets the value — the point of redaction is that
           * the inference provider never saw it, not that the user cannot.
           */
          type: 'redaction';
          values: Record<string, string>;
      }
    | {
          /** An audited admin session has opened, or widened, on a customer's server. */
          type: 'assist';
          server_uuid: string;
          server_name: string;
          writable: boolean;
          reason: string;
      }
    | { type: 'operation'; uuid: string; kind: string; status: string }
    | { type: 'step'; step: number; max_steps: number }
    | { type: 'done'; reason: string }
    | { type: 'error'; error: string; retryable?: boolean };

/** What a durable turn's start endpoint answers instead of a stream. */
export interface AgentTurnAccepted {
    turn_id: string;
    conversation_id?: number;
    conversation_title?: string;
    durable: true;
}

/** A turn the caller has in flight, discovered on page load. */
export interface ActiveAgentTurn {
    turn_id: string;
    conversation_id: number | null;
    status: 'running' | 'suspended';
    step: number;
    started_at: string | null;
    heartbeat_at: string | null;
    deadline_at: string | null;
    /** Highest sequence the turn has emitted, for a client joining from scratch. */
    latest_seq: number;
}

export interface AgentStreamCallbacks {
    onEvent: (event: AgentEvent) => void;
    onComplete: () => void;
    onError: (error: Error) => void;
    /** The endpoint accepted the request and opened its event stream. */
    onAccepted?: () => void;
    /**
     * The turn was accepted for durable execution and there is no stream on this
     * response.
     *
     * The panel decides between durable and request-bound execution server-side,
     * so the client does not carry the flag — it reads which one happened from
     * the response it actually got. With this called, nothing further arrives
     * here and the caller reattaches through the relay instead.
     */
    onDurable?: (accepted: AgentTurnAccepted) => void;
    /**
     * Sequence number of the frame just delivered, on transports that carry one.
     *
     * Only the relay does. It is the client's resume point: reconnecting with it
     * replays exactly what was missed rather than the whole turn.
     */
    onCursor?: (seq: number) => void;
    /** Effective maximum healthy silence advertised by the backend. */
    onIdleLimit?: (milliseconds: number) => void;
    /** Stable server turn id used to reconcile an accepted lost stream. */
    onTurnId?: (turnId: string) => void;
    /**
     * Anything at all arrived on the wire — an event, or one of the keep-alive
     * comments the backend sends to hold proxies open.
     *
     * Separate from `onEvent` because the question it answers is different: not
     * "what happened" but "is this connection still there". A stream can be
     * legitimately silent of events for as long as a tool takes to run, and
     * cannot be told apart from a dead socket without something that ticks
     * whether or not there is news.
     */
    onActivity?: () => void;
}

/**
 * Read an SSE body, handing each decoded `data:` payload to `onFrame`.
 *
 * Returns once the stream ends or `onFrame` reports the terminal sentinel.
 */
async function readEventStream(
    url: string,
    body: Record<string, unknown> | null,
    signal: AbortSignal | undefined,
    onFrame: (payload: string) => boolean,
    onActivity?: () => void,
    onAccepted?: () => void,
    onIdleLimit?: (milliseconds: number) => void,
    onTurnId?: (turnId: string) => void,
    onDurable?: (accepted: AgentTurnAccepted) => void,
    onCursor?: (seq: number) => void,
): Promise<void> {
    // A null body is a GET: the relay is a read of an existing turn, not a
    // request to start one.
    const response = await fetch(url, {
        method: body === null ? 'GET' : 'POST',
        headers: {
            ...(body === null ? {} : { 'Content-Type': 'application/json' }),
            Accept: 'text/event-stream',
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRF-TOKEN': readCsrfToken(),
        },
        body: body === null ? undefined : JSON.stringify({ ...body, stream: true }),
        credentials: 'same-origin',
        signal,
    });

    if (!response.ok) {
        // Failures before the stream opens (rate limits, gating, a busy
        // inference queue, a model that cannot call tools) are plain JSON, not
        // SSE. The panel's own API answers in a JSON:API envelope, which is
        // checked first: without it every one of those became "Request failed
        // (503)", discarding a sentence written specifically for this reader.
        let message = `Request failed (${response.status})`;
        try {
            const data = await response.json();
            const detail = data?.errors?.[0]?.detail;
            if (typeof detail === 'string' && detail !== '') message = detail;
            else if (typeof data?.error === 'string') message = data.error;
            else if (typeof data?.message === 'string') message = data.message;
        } catch {
            /* keep the status message */
        }
        throw new Error(message);
    }

    // A durable turn answers with JSON rather than a stream: the request's job
    // was to accept the turn, and a worker runs it. There is nothing to read
    // here, so the caller is told where to reattach and this returns.
    if ((response.headers.get('Content-Type') ?? '').includes('application/json')) {
        const accepted = (await response.json())?.data;

        if (accepted?.durable && typeof accepted.turn_id === 'string') {
            onDurable?.(accepted as AgentTurnAccepted);

            return;
        }

        throw new Error('The assistant returned an unexpected response.');
    }

    const idleSeconds = Number(response.headers.get('X-Agent-Idle-Seconds'));
    if (Number.isFinite(idleSeconds) && idleSeconds > 0) {
        onIdleLimit?.(idleSeconds * 1000);
    }
    const turnId = response.headers.get('X-Agent-Turn-Id');
    if (turnId) onTurnId?.(turnId);
    onAccepted?.();

    if (!response.body) throw new Error('Streaming is not supported by this browser.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });

        let newlineAt = buffer.indexOf('\n');
        while (newlineAt !== -1) {
            const line = buffer.slice(0, newlineAt).trim();
            buffer = buffer.slice(newlineAt + 1);
            newlineAt = buffer.indexOf('\n');

            // Counts as proof of life whatever it turns out to be, including
            // the frame separators and the keep-alive comments below.
            onActivity?.();

            // The relay stamps each frame with its sequence, which is what the
            // client presents to resume from exactly where it left off.
            if (line.startsWith('id: ')) {
                const seq = Number(line.slice(4));
                if (Number.isFinite(seq)) onCursor?.(seq);
                continue;
            }

            // `:` lines are keep-alive comments the backend sends so proxies
            // don't time out while the model is still thinking.
            if (!line.startsWith('data: ')) continue;
            if (onFrame(line.slice(6))) return;
        }
    }
}

/**
 * The agent: a tagged event stream.
 *
 * Unknown event types are dropped rather than treated as errors, so a panel
 * running slightly behind its backend degrades instead of breaking.
 */
export function streamAgentRequest(
    url: string,
    body: Record<string, unknown> | null,
    { onEvent, onComplete, onError, onActivity, onAccepted, onIdleLimit, onTurnId, onDurable, onCursor }: AgentStreamCallbacks,
    signal?: AbortSignal,
): void {
    let finished = false;

    readEventStream(
        url,
        body,
        signal,
        payload => {
            if (payload === '[DONE]') {
                finished = true;
                onComplete();
                return true;
            }

            try {
                const data = JSON.parse(payload);
                if (typeof data?.type === 'string') {
                    onEvent(data as AgentEvent);
                } else if (typeof data?.error === 'string') {
                    // A pre-agent error frame, or an error raised before the
                    // turn had a type to report under.
                    onEvent({ type: 'error', error: data.error });
                }
            } catch {
                throw new Error('The assistant sent malformed stream data.');
            }

            return false;
        },
        onActivity,
        onAccepted,
        onIdleLimit,
        onTurnId,
        accepted => {
            // Not a lost stream: the turn was handed to a worker on purpose, so
            // the caller reattaches rather than reconciling a failure.
            finished = true;
            onDurable?.(accepted);
        },
        onCursor,
    )
        .then(() => {
            if (!finished) {
                onError(new Error('The assistant connection closed before the turn completed.'));
            }
        })
        .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            onError(err instanceof Error ? err : new Error(String(err)));
        });
}
