import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import { m } from '@/i18n/messages';

// Themed markdown renderer for AI responses. GFM (tables, strikethrough,
// task lists) + copyable fenced code blocks. All colors come from theme
// tokens so it adapts to every palette.

function CodeBlock({ children }: { children: ReactNode }) {
    const [copied, setCopied] = useState(false);
    const text = extractText(children);

    const copy = () => {
        void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <div className="group/code relative my-2 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-canvas)]">
            <button
                type="button"
                onClick={copy}
                title={m['common.actions.copy']()}
                className="absolute right-1.5 top-1.5 rounded-md p-1.5 text-[var(--color-ink-faint)] opacity-0 transition-opacity hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] group-hover/code:opacity-100"
            >
                {copied ? <Check className="h-3.5 w-3.5 text-[var(--color-accent)]" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-[var(--color-ink)]">
                {children}
            </pre>
        </div>
    );
}

function extractText(node: ReactNode): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(extractText).join('');
    if (node && typeof node === 'object' && 'props' in node) {
        return extractText((node as { props: { children?: ReactNode } }).props.children);
    }
    return '';
}

export function ChatMarkdown({ content }: { content: string }) {
    return (
        <div className="min-w-0 break-words text-sm leading-relaxed text-[var(--color-ink)]">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
                    ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
                    ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>,
                    li: ({ children }) => <li className="marker:text-[var(--color-ink-faint)]">{children}</li>,
                    h1: ({ children }) => <h3 className="mb-1.5 mt-3 text-base font-semibold first:mt-0">{children}</h3>,
                    h2: ({ children }) => <h4 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h4>,
                    h3: ({ children }) => <h5 className="mb-1 mt-2.5 text-sm font-semibold first:mt-0">{children}</h5>,
                    a: ({ children, href }) => (
                        <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[var(--brand)] underline decoration-[var(--brand)]/40 underline-offset-2 hover:decoration-[var(--brand)]"
                        >
                            {children}
                        </a>
                    ),
                    blockquote: ({ children }) => (
                        <blockquote className="my-2 border-l-2 border-[var(--color-border-strong)] pl-3 text-[var(--color-ink-muted)]">
                            {children}
                        </blockquote>
                    ),
                    hr: () => <hr className="my-3 border-[var(--color-border)]" />,
                    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
                    code: ({ children, className }) =>
                        // Fenced blocks are wrapped by `pre` above; this styles inline code only.
                        className ? (
                            <code className={className}>{children}</code>
                        ) : (
                            <code className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 font-mono text-[0.85em] text-[var(--color-ink)]">
                                {children}
                            </code>
                        ),
                    table: ({ children }) => (
                        <div className="my-2 overflow-x-auto">
                            <table className="w-full border-collapse text-xs">{children}</table>
                        </div>
                    ),
                    th: ({ children }) => (
                        <th className="border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-left font-semibold">
                            {children}
                        </th>
                    ),
                    td: ({ children }) => (
                        <td className="border border-[var(--color-border)] px-2 py-1 align-top">{children}</td>
                    ),
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}
