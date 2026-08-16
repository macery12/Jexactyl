import { td } from '@/i18n';
import { cn } from '@/lib/cn';
import { restoreRedactionsDeep } from '@/state/agentChat';

// What the model is asking for, as something a person can read.
//
// These used to render as `JSON.stringify(args, null, 2)`, which is the correct
// rendering of an argument object and the wrong rendering of a question. Being
// asked to approve
//
//     { "server": "2", "reason": "Testing the assist session tooling…" }
//
// puts the punctuation of a data structure between the reader and the one
// sentence that decides the answer. Nothing is hidden by laying it out instead —
// every argument is still shown, in the order the schema declares — but the
// reason reads as a reason and the identifier reads as an identifier.
//
// Genuinely structured values (a list of options, a nested object) still fall
// back to JSON, because inventing a layout for an arbitrary shape produces
// something less trustworthy than the shape itself.

/** Arguments that carry prose and should be set as prose, not as a value. */
const PROSE_KEYS = new Set(['reason', 'question', 'message', 'description', 'note', 'summary']);

/** Arguments that are literal machine input and read better in mono. */
const CODE_KEYS = new Set([
    'command',
    'file',
    'directory',
    'root',
    'location',
    'path',
    'name',
    'content',
    'docker_image',
    'value',
]);

export function ToolArgs({
    args,
    redactions = {},
    className,
}: {
    args: Record<string, unknown>;
    /** Token => real value, for anything the panel kept out of the request. */
    redactions?: Record<string, string>;
    className?: string;
}) {
    const entries = Object.entries(args).filter(([, value]) => value !== null && value !== undefined && value !== '');

    if (entries.length === 0) return null;

    return (
        <dl className={cn('flex flex-col gap-2', className)}>
            {entries.map(([key, value]) => (
                <Argument key={key} name={key} value={restoreRedactionsDeep(value, redactions)} />
            ))}
        </dl>
    );
}

function Argument({ name, value }: { name: string; value: unknown }) {
    const label = argumentLabel(name);

    if (typeof value === 'object') {
        return (
            <div>
                <Label>{label}</Label>
                <dd>
                    <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 font-mono text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
                        {stringify(value)}
                    </pre>
                </dd>
            </div>
        );
    }

    if (typeof value === 'boolean') {
        return (
            <div className="flex items-baseline gap-2">
                <Label>{label}</Label>
                <dd className="text-xs text-[var(--color-ink)]">
                    {value ? td('common.actions.yes', 'Yes') : td('common.actions.no', 'No')}
                </dd>
            </div>
        );
    }

    const text = String(value);

    // Prose gets its own line and a readable measure; anything long enough to
    // wrap does too, whatever it is called.
    if (PROSE_KEYS.has(name) || (!CODE_KEYS.has(name) && text.length > 60)) {
        return (
            <div>
                <Label>{label}</Label>
                <dd className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--color-ink)]">
                    {text}
                </dd>
            </div>
        );
    }

    return (
        <div className="flex items-baseline gap-2">
            <Label>{label}</Label>
            <dd
                className={cn(
                    'min-w-0 flex-1 break-all text-xs text-[var(--color-ink)]',
                    CODE_KEYS.has(name) && 'font-mono text-[11px]',
                )}
            >
                {text}
            </dd>
        </div>
    );
}

function Label({ children }: { children: string }) {
    return (
        <dt className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
            {children}
        </dt>
    );
}

/**
 * The human name for one argument.
 *
 * Localised where a key has earned a translation, and otherwise the key with its
 * underscores opened out — which is already readable, because tool schemas are
 * written to be read by a model in English. A new backend argument therefore
 * renders sensibly on the day it ships rather than on the day someone remembers
 * to translate it.
 */
function argumentLabel(key: string): string {
    return td(`server.ai.args.${key}`, key.replace(/_/g, ' '));
}

function stringify(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
        return String(value);
    }
}
