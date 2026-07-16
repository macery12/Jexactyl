import { m } from '@/i18n';
import { useState } from 'react';
import { Copy, Check, Download, TriangleAlert } from 'lucide-react';

// Renders a freshly generated recovery code once, with copy + download affordances.
// The download is built entirely client-side (Blob) so the plaintext is never sent
// back to the server or written to an access log. Shared by the registration reveal
// step and the account-settings regenerate modal.
export function RecoveryCodeDisplay({ code }: { code: string }) {
    const [copied, setCopied] = useState(false);

    const copy = () => {
        navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };

    const download = () => {
        const body = `${m['account.recoveryCode.fileHeader']()}\n\n${code}\n`;
        const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'recovery-code.txt';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2.5 text-sm text-[var(--color-ink)]">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" />
                <span>{m['account.recoveryCode.warning']()}</span>
            </div>

            <div className="break-all rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-4 text-center font-mono text-sm tracking-wide text-[var(--color-ink)]">
                {code}
            </div>

            <div className="flex items-center justify-center gap-4">
                <button
                    type="button"
                    onClick={copy}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                >
                    {copied ? (
                        <Check className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                    ) : (
                        <Copy className="h-3.5 w-3.5" />
                    )}
                    {copied ? m['common.states.copied']() : m['account.recoveryCode.copy']()}
                </button>
                <button
                    type="button"
                    onClick={download}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                >
                    <Download className="h-3.5 w-3.5" />
                    {m['account.recoveryCode.download']()}
                </button>
            </div>
        </div>
    );
}
