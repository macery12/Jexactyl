import { m } from '@/i18n';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { AccountTab } from './AccountTab';
import { DevicesTab } from './DevicesTab';

type TabId = 'account' | 'devices';

export default function AccountPage() {
    const [tab, setTab] = useState<TabId>('account');

    const tabs: { id: TabId; label: string }[] = [
        { id: 'account', label: m['account.tabs.account']() },
        { id: 'devices', label: m['account.tabs.devices']() },
    ];

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">{m['account.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['account.subtitle']()}</p>
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

            {tab === 'account' ? <AccountTab /> : <DevicesTab />}
        </div>
    );
}
