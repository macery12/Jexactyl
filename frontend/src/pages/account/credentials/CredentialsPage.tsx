import { m } from '@/i18n/messages';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import ApiKeysTab from './ApiKeysTab';
import SshKeysTab from './SshKeysTab';

type TabId = 'api' | 'ssh';

// Credentials — account API keys + SSH keys. Two tabs, each a settings-style
// list of rows with a create modal. Mirrors V1's `credentials` page.
export default function CredentialsPage() {
    const [tab, setTab] = useState<TabId>('api');

    const tabs: { id: TabId; label: string }[] = [
        { id: 'api', label: m['account.credentials.tabs.api']() },
        { id: 'ssh', label: m['account.credentials.tabs.ssh']() },
    ];

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">{m['account.credentials.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['account.credentials.subtitle']()}</p>
            </div>

            <div className="flex gap-1 border-b border-[var(--color-border)]">
                {tabs.map(t => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => setTab(t.id)}
                        className={cn(
                            'relative px-4 py-2 text-sm font-medium transition-colors',
                            tab === t.id
                                ? 'text-[var(--color-ink)]'
                                : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                        )}
                    >
                        {t.label}
                        {tab === t.id && (
                            <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[var(--brand)]" />
                        )}
                    </button>
                ))}
            </div>

            {tab === 'api' ? <ApiKeysTab /> : <SshKeysTab />}
        </div>
    );
}
