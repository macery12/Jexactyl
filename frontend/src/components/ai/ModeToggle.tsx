import { MessageSquare, Wrench } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import type { ChatMode } from '@/state/agentChat';

// Chat or Agent.
//
// Two endpoints with genuinely different costs sit behind this: chat is a
// single fast completion, while an agent turn carries tool schemas, passes the
// inference queue, and can change the server. Making that an explicit choice
// keeps "what's a good heap size?" cheap and keeps tool use something the user
// opted into.
export function ModeToggle({
    mode,
    onChange,
    agentAvailable,
    disabled,
}: {
    mode: ChatMode;
    onChange: (mode: ChatMode) => void;
    agentAvailable: boolean;
    disabled?: boolean;
}) {
    const options: { value: ChatMode; label: string; icon: typeof Wrench; hint: string; enabled: boolean }[] = [
        {
            value: 'chat',
            label: m['server.ai.mode.chat'](),
            icon: MessageSquare,
            hint: m['server.ai.mode.chatHint'](),
            enabled: true,
        },
        {
            value: 'agent',
            label: m['server.ai.mode.agent'](),
            icon: Wrench,
            hint: agentAvailable ? m['server.ai.mode.agentHint']() : m['server.ai.mode.agentUnavailable'](),
            enabled: agentAvailable,
        },
    ];

    return (
        <div className="inline-flex rounded-md border border-[var(--color-border-strong)] p-0.5">
            {options.map(option => {
                const active = mode === option.value;

                return (
                    <button
                        key={option.value}
                        type="button"
                        title={option.hint}
                        disabled={disabled || !option.enabled}
                        onClick={() => onChange(option.value)}
                        className={cn(
                            'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                            active
                                ? 'bg-[var(--brand)] text-[var(--color-brand-ink)]'
                                : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                            !option.enabled && 'cursor-not-allowed opacity-40',
                        )}
                    >
                        <option.icon className="h-3.5 w-3.5" />
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
