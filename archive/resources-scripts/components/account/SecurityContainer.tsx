import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import tw from 'twin.macro';
import { Link } from 'react-router-dom';
import { formatDistanceToNowStrict } from 'date-fns';
import {
    ShieldCheckIcon,
    DesktopComputerIcon,
    DeviceMobileIcon,
    CheckCircleIcon,
    ExclamationCircleIcon,
    KeyIcon,
    PencilIcon,
    CheckIcon,
    XIcon,
    LockClosedIcon,
} from '@heroicons/react/solid';
import ContentBox from '@/elements/ContentBox';
import PageContentBlock from '@/elements/PageContentBlock';
import FlashMessageRender from '@/elements/FlashMessageRender';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import Spinner from '@/elements/Spinner';
import Pill from '@/elements/Pill';
import { Button } from '@/elements/button';
import Tooltip from '@/elements/tooltip/Tooltip';
import ConfirmationDialog from '@/elements/dialog/ConfirmationDialog';
import { useFlashKey } from '@/plugins/useFlash';
import {
    getAccountSessions,
    getAccountSessionHistory,
    revokeAccountSession,
    revokeAllAccountSessions,
    labelAccountSession,
} from '@/api/routes/account';
import { useActivityLogs } from '@/api/routes/account/activity';
import { AccountSession } from '@definitions/account';
import { useStoreState } from '@/state/hooks';
import classNames from 'classnames';

type DeviceType = 'desktop' | 'mobile' | 'tablet';

interface ParsedDevice {
    browser: string;
    os: string;
    type: DeviceType;
    label: string;
}

const parseDevice = (ua: string | null): ParsedDevice => {
    if (!ua) return { browser: 'Unknown', os: 'Unknown', type: 'desktop', label: 'Unknown device' };
    const isMobile = /Mobile|Android|iPhone/i.test(ua) && !/iPad/i.test(ua);
    const isTablet = /iPad|Tablet/i.test(ua);
    const browser = /(Chrome|Firefox|Safari|Edg|Opera)[\/ ]([\d.]+)/i.exec(ua)?.[1]?.replace('Edg', 'Edge') ?? 'Browser';
    const os = /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : /Android/.test(ua)
              ? 'Android'
              : /iPhone|iPad/.test(ua)
                ? 'iOS'
                : 'Unknown OS';
    const type: DeviceType = isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop';
    return { browser, os, type, label: `${browser} on ${os}` };
};

const relativeTime = (date: Date | null) =>
    date ? formatDistanceToNowStrict(date, { addSuffix: true }) : '—';

const authEventLabel: Record<string, string> = {
    'auth:success': 'Login',
    'auth:fail': 'Failed login attempt',
    'auth:checkpoint': '2FA checkpoint',
    'auth:session_revoked': 'Session revoked',
    'auth:2fa_enabled': '2FA enabled',
    'auth:2fa_disabled': '2FA disabled',
    'auth:password_reset': 'Password reset',
};

const AuthEventIcon = ({ event }: { event: string }) => {
    if (event === 'auth:fail') return <XIcon css={tw`w-4 h-4 text-red-400`} />;
    if (event === 'auth:checkpoint') return <KeyIcon css={tw`w-4 h-4 text-yellow-400`} />;
    if (event === 'auth:session_revoked') return <LockClosedIcon css={tw`w-4 h-4 text-gray-400`} />;
    return <CheckCircleIcon css={tw`w-4 h-4 text-green-400`} />;
};

const DeviceIcon = ({ type, isCurrent }: { type: DeviceType; isCurrent: boolean }) => {
    const cls = classNames('w-8 h-8', isCurrent ? 'text-indigo-400' : 'text-gray-400');
    if (type === 'mobile' || type === 'tablet') return <DeviceMobileIcon className={cls} />;
    return <DesktopComputerIcon className={cls} />;
};

interface InlineLabelEditorProps {
    sessionId: number;
    current: string | null;
    placeholder: string;
    onSaved: () => void;
}

const InlineLabelEditor = ({ sessionId, current, placeholder, onSaved }: InlineLabelEditorProps) => {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(current ?? '');
    const [saving, setSaving] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const open = () => {
        setValue(current ?? '');
        setEditing(true);
        setTimeout(() => inputRef.current?.focus(), 0);
    };

    const save = async () => {
        if (saving) return;
        setSaving(true);
        await labelAccountSession(sessionId, value.trim() || null).catch(() => null);
        setSaving(false);
        setEditing(false);
        onSaved();
    };

    const cancel = () => {
        setEditing(false);
        setValue(current ?? '');
    };

    if (!editing) {
        return (
            <button
                className="group"
                css={tw`flex items-center gap-1 text-left`}
                onClick={open}
                title="Rename this device"
            >
                <span css={tw`font-semibold text-white group-hover:text-indigo-300 transition-colors`}>
                    {current || placeholder}
                </span>
                <PencilIcon css={tw`w-3 h-3 text-gray-500 group-hover:text-indigo-400 transition-colors`} />
            </button>
        );
    }

    return (
        <div css={tw`flex items-center gap-1`}>
            <input
                ref={inputRef}
                css={tw`bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-sm text-white focus:outline-none focus:border-indigo-500 w-44`}
                value={value}
                maxLength={100}
                placeholder={placeholder}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => {
                    if (e.key === 'Enter') void save();
                    if (e.key === 'Escape') cancel();
                }}
            />
            <button onClick={() => void save()} disabled={saving} css={tw`text-green-400 hover:text-green-300`}>
                <CheckIcon css={tw`w-4 h-4`} />
            </button>
            <button onClick={cancel} css={tw`text-gray-400 hover:text-gray-300`}>
                <XIcon css={tw`w-4 h-4`} />
            </button>
        </div>
    );
};

interface SessionCardProps {
    session: AccountSession;
    onRevoke: (id: number) => void;
    onLabelSaved: () => void;
}

const SessionCard = ({ session, onRevoke, onLabelSaved }: SessionCardProps) => {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const device = useMemo(() => parseDevice(session.userAgent), [session.userAgent]);

    return (
        <div
            css={tw`rounded-lg border bg-black/30 p-4 flex gap-4`}
            className={classNames(
                session.isCurrent ? 'border-indigo-600/60' : 'border-gray-800',
            )}
        >
            <div css={tw`flex-shrink-0 mt-0.5`}>
                <DeviceIcon type={device.type} isCurrent={session.isCurrent} />
            </div>
            <div css={tw`flex-1 min-w-0`}>
                <div css={tw`flex items-start justify-between gap-2 flex-wrap`}>
                    <div css={tw`min-w-0`}>
                        <InlineLabelEditor
                            sessionId={session.id}
                            current={session.deviceLabel}
                            placeholder={device.label}
                            onSaved={onLabelSaved}
                        />
                        {session.deviceLabel && (
                            <div css={tw`text-xs text-gray-500 mt-0.5 truncate`}>{device.label}</div>
                        )}
                    </div>
                    <div css={tw`flex items-center gap-2 flex-shrink-0`}>
                        {session.isCurrent && <Pill type="success">Current</Pill>}
                        {!session.isCurrent && <Pill type="info">Active</Pill>}
                        {!session.isCurrent && (
                            <Button.Text
                                size={Button.Sizes.Small}
                                css={tw`text-red-400 hover:text-red-300`}
                                onClick={() => setConfirmOpen(true)}
                            >
                                Log out
                            </Button.Text>
                        )}
                    </div>
                </div>
                <div css={tw`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-400`}>
                    <span>
                        <span css={tw`text-gray-500`}>IP</span>{' '}
                        <span css={tw`text-gray-300`}>{session.ipAddress || 'Unknown'}</span>
                    </span>
                    {session.location && (
                        <span>
                            <span css={tw`text-gray-500`}>Location</span>{' '}
                            <span css={tw`text-gray-300`}>{session.location}</span>
                        </span>
                    )}
                    <span>
                        <span css={tw`text-gray-500`}>First seen</span>{' '}
                        <Tooltip content={session.createdAt.toLocaleString()}>
                            <span css={tw`text-gray-300 cursor-default`}>{relativeTime(session.createdAt)}</span>
                        </Tooltip>
                    </span>
                    <span>
                        <span css={tw`text-gray-500`}>Last active</span>{' '}
                        <Tooltip content={session.lastActivityAt?.toLocaleString() ?? '—'}>
                            <span css={tw`text-gray-300 cursor-default`}>{relativeTime(session.lastActivityAt)}</span>
                        </Tooltip>
                    </span>
                </div>
            </div>

            <ConfirmationDialog
                open={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                title="Log out device?"
                confirm="Log out"
                buttonType="danger"
                onConfirmed={() => {
                    setConfirmOpen(false);
                    onRevoke(session.id);
                }}
            >
                This will sign out the <strong className="text-white">{session.deviceLabel || device.label}</strong> session. It
                will lose access to your account immediately.
            </ConfirmationDialog>
        </div>
    );
};

export default () => {
    const { clearAndAddHttpError, clearFlashes } = useFlashKey('account:sessions');
    const user = useStoreState(s => s.user.data!);

    const { data, error, mutate, isValidating } = useSWR<AccountSession[]>(
        ['account', 'sessions'],
        () => getAccountSessions(),
        { revalidateOnFocus: false, revalidateOnMount: true },
    );

    const [showHistory, setShowHistory] = useState(false);
    const { data: history, mutate: mutateHistory } = useSWR<AccountSession[]>(
        showHistory ? ['account', 'sessions', 'history'] : null,
        () => getAccountSessionHistory(),
        { revalidateOnFocus: false },
    );

    const { data: activityData } = useActivityLogs(
        { page: 1, filters: { event: 'auth:' }, sorts: { timestamp: -1 } },
        { revalidateOnMount: true, revalidateOnFocus: false },
    );

    useEffect(() => {
        clearAndAddHttpError(error);
    }, [error]);

    const handleRevoke = async (id: number) => {
        clearFlashes();
        await revokeAccountSession(id);
        await mutate();
    };

    const [confirmRevokeAllOpen, setConfirmRevokeAllOpen] = useState(false);

    const handleRevokeAll = async () => {
        clearFlashes();
        await revokeAllAccountSessions(false);
        await mutate();
        if (showHistory) await mutateHistory();
    };

    const activeCount = useMemo(() => data?.filter(s => !s.revokedAt).length ?? 0, [data]);
    const currentSession = useMemo(() => data?.find(s => s.isCurrent), [data]);
    const revokedCount = useMemo(() => history?.length ?? 0, [history]);

    const recentAuthEvents = useMemo(
        () => activityData?.items.filter(a => a.event.startsWith('auth:')).slice(0, 5) ?? [],
        [activityData],
    );

    return (
        <PageContentBlock
            title="Account Security"
            header
            description="Review active sessions, manage devices, and monitor recent login activity."
        >
            <FlashMessageRender byKey="account:sessions" />

            {/* Overview stat cards */}
            <div css={tw`grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6`}>
                <div css={tw`rounded-lg border border-gray-800 bg-black/30 p-4`}>
                    <div css={tw`flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider mb-2`}>
                        <ShieldCheckIcon css={tw`w-4 h-4`} />
                        Two-Factor Auth
                    </div>
                    {user.useTotp ? (
                        <div css={tw`flex items-center gap-1.5 text-green-400 font-semibold`}>
                            <CheckCircleIcon css={tw`w-5 h-5`} />
                            Enabled
                        </div>
                    ) : (
                        <div>
                            <div css={tw`flex items-center gap-1.5 text-yellow-400 font-semibold`}>
                                <ExclamationCircleIcon css={tw`w-5 h-5`} />
                                Not enabled
                            </div>
                            <Link to="/account" css={tw`text-xs text-indigo-400 hover:text-indigo-300 mt-1 inline-block`}>
                                Enable 2FA →
                            </Link>
                        </div>
                    )}
                </div>

                <div css={tw`rounded-lg border border-gray-800 bg-black/30 p-4`}>
                    <div css={tw`flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider mb-2`}>
                        <DesktopComputerIcon css={tw`w-4 h-4`} />
                        Active Sessions
                    </div>
                    <div css={tw`text-2xl font-bold text-white`}>{activeCount}</div>
                    <div css={tw`text-xs text-gray-500 mt-0.5`}>
                        {activeCount === 1 ? 'device signed in' : 'devices signed in'}
                    </div>
                </div>

                <div css={tw`rounded-lg border border-gray-800 bg-black/30 p-4`}>
                    <div css={tw`flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider mb-2`}>
                        <KeyIcon css={tw`w-4 h-4`} />
                        Last Login
                    </div>
                    {currentSession ? (
                        <>
                            <div css={tw`text-white font-semibold`}>{relativeTime(currentSession.lastActivityAt)}</div>
                            <div css={tw`text-xs text-gray-500 mt-0.5`}>{currentSession.ipAddress || 'Unknown IP'}</div>
                        </>
                    ) : (
                        <div css={tw`text-gray-500 text-sm`}>—</div>
                    )}
                </div>
            </div>

            {/* Active sessions */}
            <ContentBox
                title="Active Sessions"
                css={tw`mb-6`}
            >
                <div css={tw`flex justify-between items-center mb-4`}>
                    <p css={tw`text-sm text-gray-400`}>
                        {activeCount > 0
                            ? 'These devices currently have access to your account. Click a device name to rename it.'
                            : 'No active sessions found.'}
                    </p>
                    {activeCount > 1 && (
                        <Button.Danger size={Button.Sizes.Small} onClick={() => setConfirmRevokeAllOpen(true)}>
                            Log out all other devices
                        </Button.Danger>
                    )}
                </div>
                <SpinnerOverlay visible={!data && isValidating} />
                {data && (
                    <div css={tw`space-y-3`}>
                        {data.map(session => (
                            <SessionCard
                                key={session.id}
                                session={session}
                                onRevoke={id => void handleRevoke(id)}
                                onLabelSaved={() => void mutate()}
                            />
                        ))}
                        {data.length === 0 && (
                            <p css={tw`text-sm text-gray-400`}>No active sessions.</p>
                        )}
                    </div>
                )}

                {/* Revoked session history toggle */}
                <div css={tw`mt-4 border-t border-gray-800 pt-4`}>
                    <button
                        css={tw`text-sm text-gray-500 hover:text-gray-300 transition-colors`}
                        onClick={() => setShowHistory(v => !v)}
                    >
                        {showHistory
                            ? 'Hide session history'
                            : `Show session history${revokedCount > 0 ? ` (${revokedCount})` : ''}`}
                    </button>
                    {showHistory && (
                        <div css={tw`mt-3 space-y-2`}>
                            {!history ? (
                                <Spinner size="small" centered />
                            ) : history.length === 0 ? (
                                <p css={tw`text-sm text-gray-500`}>No previous sessions.</p>
                            ) : (
                                history.map(session => {
                                    const device = parseDevice(session.userAgent);
                                    return (
                                        <div
                                            key={session.id}
                                            css={tw`rounded border border-gray-800 bg-black/20 px-4 py-3 flex gap-3 items-center opacity-60`}
                                        >
                                            <DeviceIcon type={device.type} isCurrent={false} />
                                            <div css={tw`flex-1 min-w-0`}>
                                                <div css={tw`text-sm text-gray-400 line-through`}>
                                                    {session.deviceLabel || device.label}
                                                </div>
                                                <div css={tw`text-xs text-gray-600 mt-0.5`}>
                                                    {session.ipAddress || 'Unknown IP'} · Revoked{' '}
                                                    {relativeTime(session.revokedAt)}
                                                </div>
                                            </div>
                                            <Pill type="danger">Revoked</Pill>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    )}
                </div>
            </ContentBox>

            {/* Recent security activity */}
            <ContentBox title="Recent Security Activity">
                <div css={tw`flex justify-between items-center mb-4`}>
                    <p css={tw`text-sm text-gray-400`}>Recent authentication events on your account.</p>
                    <Link
                        to="/account/activity"
                        css={tw`text-sm text-indigo-400 hover:text-indigo-300 transition-colors`}
                    >
                        View all activity →
                    </Link>
                </div>
                {!activityData ? (
                    <Spinner size="small" centered />
                ) : recentAuthEvents.length === 0 ? (
                    <p css={tw`text-sm text-gray-400`}>No recent authentication events.</p>
                ) : (
                    <div css={tw`space-y-2`}>
                        {recentAuthEvents.map(event => (
                            <div
                                key={event.id}
                                css={tw`flex items-center gap-3 py-2 border-b border-gray-800 last:border-0`}
                            >
                                <AuthEventIcon event={event.event} />
                                <div css={tw`flex-1 min-w-0`}>
                                    <span css={tw`text-sm text-gray-200`}>
                                        {authEventLabel[event.event] ?? event.event}
                                    </span>
                                    {event.ip && (
                                        <span css={tw`text-xs text-gray-500 ml-2`}>{event.ip}</span>
                                    )}
                                </div>
                                <Tooltip content={event.timestamp.toLocaleString()}>
                                    <span css={tw`text-xs text-gray-500 cursor-default flex-shrink-0`}>
                                        {relativeTime(event.timestamp)}
                                    </span>
                                </Tooltip>
                            </div>
                        ))}
                    </div>
                )}
            </ContentBox>

            <ConfirmationDialog
                open={confirmRevokeAllOpen}
                onClose={() => setConfirmRevokeAllOpen(false)}
                title="Log out all other devices?"
                confirm="Log out all"
                buttonType="danger"
                onConfirmed={() => {
                    setConfirmRevokeAllOpen(false);
                    void handleRevokeAll();
                }}
            >
                This will immediately sign out every device except the one you are using right now. Those sessions
                will lose access to your account.
            </ConfirmationDialog>
        </PageContentBlock>
    );
};
