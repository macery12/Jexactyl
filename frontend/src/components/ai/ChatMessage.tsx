import { useState } from 'react';
import { Bot, Check, Copy } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { ChatMarkdown } from './ChatMarkdown';

export interface ChatMessageData {
    role: 'user' | 'assistant';
    content: string;
    streaming?: boolean;
    error?: boolean;
}

function CopyResponseButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);

    const copy = () => {
        void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <button
            type="button"
            onClick={copy}
            title={m['common.actions.copy']()}
            className="rounded-md p-1 text-[var(--color-ink-faint)] opacity-0 transition-opacity hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] group-hover:opacity-100"
        >
            {copied ? <Check className="h-3.5 w-3.5 text-[var(--color-accent)]" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
    );
}

// One chat turn, ChatGPT-style: user messages are right-aligned bubbles,
// assistant messages sit flush-left next to a brand avatar as plain rich text
// with a hover copy affordance and a pulsing caret while streaming.
export function ChatMessage({ message }: { message: ChatMessageData }) {
    if (message.role === 'user') {
        return (
            <div className="flex justify-end">
                <div
                    className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg rounded-br-md bg-[var(--color-surface-2)] px-4 py-2.5 text-sm leading-relaxed text-[var(--color-ink)]"
                    style={{ borderRadius: 'var(--radius-card)' }}
                >
                    {message.content}
                </div>
            </div>
        );
    }

    return (
        <div className="group flex gap-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)]">
                <Bot className="h-4 w-4 text-[var(--brand)]" />
            </div>
            <div className="min-w-0 flex-1">
                <div className={cn(message.error && 'text-[var(--color-danger)]')}>
                    <ChatMarkdown content={message.content} />
                    {message.streaming && (
                        <span className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-[var(--brand)] align-text-bottom" />
                    )}
                </div>
                {!message.streaming && message.content && !message.error && (
                    <div className="mt-1 flex">
                        <CopyResponseButton text={message.content} />
                    </div>
                )}
            </div>
        </div>
    );
}
