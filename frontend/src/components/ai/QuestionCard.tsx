import { useState } from 'react';
import { Check, HelpCircle } from 'lucide-react';
import { m } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ChatEntry } from '@/state/agentChat';

type QuestionEntry = Extract<ChatEntry, { kind: 'question' }>;

// The model has asked something and the turn is waiting on the answer.
//
// Structurally the same suspension as an approval, and deliberately not styled
// like one: an approval is a decision about something that is about to happen to
// the user's data, while this is only a fork in the work. Making them look alike
// would train people to click through both.
export function QuestionCard({
    entry,
    disabled,
    onAnswer,
    onDismiss,
}: {
    entry: QuestionEntry;
    disabled: boolean;
    onAnswer: (answer: string) => void;
    onDismiss: () => void;
}) {
    const [other, setOther] = useState('');
    const submitting = entry.submission === 'submitting';

    if (entry.answer) {
        return (
            <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-ink-faint)]">
                <Check className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                <span className="truncate">{m['server.ai.question.answered']({ answer: entry.answer })}</span>
            </div>
        );
    }

    if (entry.dismissed) {
        return (
            <div className="rounded-md border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-ink-faint)]">
                {m['server.ai.question.dismissed']()}
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)]">
            <div className="flex items-start gap-2 px-3 pb-1 pt-2.5">
                <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-ink-muted)]" />
                <p className="min-w-0 flex-1 text-sm font-medium text-[var(--color-ink)]">{entry.question}</p>
            </div>

            <div className="flex flex-col gap-1.5 px-3 py-2">
                {entry.options.map(option => (
                    <button
                        key={option.label}
                        type="button"
                        disabled={disabled || submitting}
                        onClick={() => onAnswer(option.label)}
                        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left transition-colors hover:border-[var(--brand)]/50 hover:bg-[var(--brand-soft)] disabled:opacity-50"
                    >
                        <span className="block text-sm text-[var(--color-ink)]">{option.label}</span>
                        {option.description && (
                            <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">
                                {option.description}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {entry.allowOther && (
                <div className="flex items-center gap-2 px-3 pb-2">
                    <Input
                        value={other}
                        onChange={event => setOther(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && other.trim() !== '' && !disabled) {
                                event.preventDefault();
                                onAnswer(other.trim());
                            }
                        }}
                        placeholder={m['server.ai.question.otherPlaceholder']()}
                        disabled={disabled || submitting}
                    />
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={disabled || submitting || other.trim() === ''}
                        onClick={() => onAnswer(other.trim())}
                    >
                        {m['server.ai.question.send']()}
                    </Button>
                </div>
            )}

            {entry.submission === 'failed' && (
                <p className="px-3 pb-2 text-xs text-[var(--color-danger)]">
                    {m['server.ai.decision.retry']()}
                </p>
            )}

            <div className="flex justify-end border-t border-[var(--color-border)] px-3 py-1.5">
                <Button size="sm" variant="ghost" disabled={disabled || submitting} onClick={onDismiss}>
                    {m['server.ai.question.dismiss']()}
                </Button>
            </div>
        </div>
    );
}
