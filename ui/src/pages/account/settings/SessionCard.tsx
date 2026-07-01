import { m } from '@/i18n';
import { useState } from 'react';
import { Monitor, Smartphone, Pencil, Check, X, LogOut } from 'lucide-react';
import { timeAgo } from '@/lib/format';
import type { UserSession } from '@/api/sessions';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

function isMobile(userAgent: string | null): boolean {
    return !!userAgent && /mobile|android|iphone|ipad/i.test(userAgent);
}

// A single active/revoked device session. Owns its inline-rename state; revoke
// and label mutations are driven by the parent via callbacks.
export function SessionCard({
    session,
    revoked = false,
    renaming,
    onRename,
    onRevoke,
}: {
    session: UserSession;
    revoked?: boolean;
    renaming?: boolean;
    onRename?: (label: string | null) => void;
    onRevoke?: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(session.deviceLabel ?? '');

    const DeviceIcon = isMobile(session.userAgent) ? Smartphone : Monitor;
    const name = session.deviceLabel || session.deviceName;
    const location = [session.location, session.ip].filter(Boolean).join(' · ');
    const stamp = revoked ? session.revokedAt : session.lastActivityAt;

    const startEdit = () => {
        setDraft(session.deviceLabel ?? '');
        setEditing(true);
    };
    const save = () => {
        onRename?.(draft.trim() || null);
        setEditing(false);
    };

    return (
        <div className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-4 py-3">
            <DeviceIcon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-ink-faint)]" />

            <div className="min-w-0 flex-1">
                {editing ? (
                    <div className="flex items-center gap-2">
                        <Input
                            autoFocus
                            value={draft}
                            maxLength={100}
                            placeholder={session.deviceName}
                            onChange={e => setDraft(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') save();
                                if (e.key === 'Escape') setEditing(false);
                            }}
                        />
                        <button
                            type="button"
                            onClick={save}
                            disabled={renaming}
                            className="shrink-0 rounded-lg p-1.5 text-[var(--color-accent)] hover:bg-[var(--color-surface-2)]"
                            aria-label={m['account.devices.saveLabel']()}
                        >
                            {renaming ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                        </button>
                        <button
                            type="button"
                            onClick={() => setEditing(false)}
                            disabled={renaming}
                            className="shrink-0 rounded-lg p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]"
                            aria-label={m['account.devices.cancelLabel']()}
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-[var(--color-ink)]">{name}</span>
                        {session.isCurrent && (
                            <span className="inline-flex shrink-0 items-center rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                                {m['account.devices.current']()}
                            </span>
                        )}
                        {!revoked && onRename && (
                            <button
                                type="button"
                                onClick={startEdit}
                                className="shrink-0 rounded-lg p-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                                aria-label={m['account.devices.rename']()}
                            >
                                <Pencil className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                )}

                {session.deviceLabel && !editing && (
                    <p className="truncate text-xs text-[var(--color-ink-faint)]">{session.deviceName}</p>
                )}
                <p className="mt-0.5 truncate text-xs text-[var(--color-ink-muted)]">
                    {location || m['account.devices.unknownLocation']()}
                </p>
                {stamp && (
                    <p className="text-xs text-[var(--color-ink-faint)]">
                        {revoked
                            ? m['account.devices.revokedAgo']({ ago: timeAgo(stamp) })
                            : m['account.devices.activeAgo']({ ago: timeAgo(stamp) })}
                    </p>
                )}
            </div>

            {!revoked && !session.isCurrent && onRevoke && (
                <Button variant="ghost" size="sm" onClick={onRevoke} className="shrink-0">
                    <LogOut className="h-4 w-4" />
                    {m['account.devices.revoke']()}
                </Button>
            )}
        </div>
    );
}
