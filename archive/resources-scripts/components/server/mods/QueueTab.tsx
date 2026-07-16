import { useCallback, useEffect, useRef, useState } from 'react';
import tw from 'twin.macro';
import { ServerContext } from '@/state/server';
import {
    type DownloadQueueItem,
    getDownloadQueue,
    cancelQueueItem,
    retryQueueItem,
    bulkClearQueue,
} from '@/api/routes/server/mods';

type QueueItem = DownloadQueueItem & {
    parent_id?: number | null;
};

// Turn a modpack install phase token into a human step label. The "mods" phase
// encodes batch position as "mods:2/4".
const phaseLabel = (phase?: string | null): string => {
    if (!phase) return 'Installing…';
    if (phase === 'waiting_reinstall') return 'Waiting for server reinstall…';
    if (phase === 'preparing') return 'Preparing…';
    if (phase === 'overrides') return 'Step 1 of 2: Installing overrides…';
    if (phase === 'verifying') return 'Verifying & finishing up…';
    if (phase.startsWith('mods')) {
        const m = phase.match(/^mods:(\d+)\/(\d+)$/);
        return m ? `Step 2 of 2: Installing mods (batch ${m[1]} of ${m[2]})` : 'Step 2 of 2: Installing mods…';
    }
    return 'Installing…';
};
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faCircleNotch,
    faClock,
    faCheck,
    faXmark,
    faRotateRight,
    faDownload,
    faInbox,
    faTrash,
    faTriangleExclamation,
    faFileLines,
} from '@fortawesome/free-solid-svg-icons';
import Spinner from '@/elements/Spinner';
import Input from '@/elements/Input';

const POLL_INTERVAL_MS = 5000;
const COMPLETED_TTL_MS = 15 * 60 * 1000;

function isExpiredCompleted(item: QueueItem): boolean {
    if (item.status !== 'completed') return false;
    const completedAt = item.completed_at ? new Date(item.completed_at).getTime() : new Date(item.created_at).getTime();
    return Date.now() - completedAt > COMPLETED_TTL_MS;
}

const STATUS_ORDER: Record<DownloadQueueItem['status'], number> = {
    downloading: 0,
    pending: 1,
    failed: 2,
    completed: 3,
};

const statusLabel: Record<DownloadQueueItem['status'], string> = {
    downloading: 'Downloading',
    pending: 'Pending',
    failed: 'Failed',
    completed: 'Completed',
};

interface PendingClear {
    uuids: string[] | null; // null = "all"
    activeCount: number;
}

export default function QueueTab() {
    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const [items, setItems] = useState<QueueItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionPending, setActionPending] = useState<string | null>(null);
    const [selected, setSelected] = useState<string[]>([]);
    const [pendingClear, setPendingClear] = useState<PendingClear | null>(null);
    const [bulkPending, setBulkPending] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const hasActive = items.some(i => i.status === 'pending' || i.status === 'downloading');

    const fetchQueue = useCallback(
        (showSpinner = false) => {
            if (showSpinner) setLoading(true);
            getDownloadQueue(uuid)
                .then(res => {
                    if (Array.isArray(res.data)) {
                        const all = res.data as QueueItem[];
                        setItems(all.filter(i => !i.parent_id).filter(i => !isExpiredCompleted(i)));
                    }
                })
                .catch(() => {})
                .finally(() => setLoading(false));
        },
        [uuid],
    );

    useEffect(() => {
        const id = setInterval(() => {
            setItems(prev => prev.filter(i => !isExpiredCompleted(i)));
        }, 60_000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        fetchQueue(true);
        pollRef.current = setInterval(() => fetchQueue(false), POLL_INTERVAL_MS);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [fetchQueue]);

    useEffect(() => {
        if (!hasActive && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        } else if (hasActive && !pollRef.current) {
            pollRef.current = setInterval(() => fetchQueue(false), POLL_INTERVAL_MS);
        }
    }, [hasActive, fetchQueue]);

    // Deselect items that disappear from the list.
    useEffect(() => {
        const ids = new Set(items.map(i => i.uuid));
        setSelected(prev => prev.filter(id => ids.has(id)));
    }, [items]);

    const handleCancel = (queueId: string) => {
        setActionPending(queueId);
        cancelQueueItem(uuid, queueId)
            .then(() => setItems(prev => prev.filter(i => i.uuid !== queueId)))
            .catch(() => {})
            .finally(() => setActionPending(null));
    };

    const handleRetry = (queueId: string) => {
        setActionPending(queueId);
        retryQueueItem(uuid, queueId)
            .then(() => {
                setItems(prev =>
                    prev.map(i => (i.uuid === queueId ? { ...i, status: 'pending', error_message: null } : i)),
                );
                if (!pollRef.current) {
                    pollRef.current = setInterval(() => fetchQueue(false), POLL_INTERVAL_MS);
                }
            })
            .catch(() => {})
            .finally(() => setActionPending(null));
    };

    const handleDismiss = (queueId: string) => {
        setItems(prev => prev.filter(i => i.uuid !== queueId));
    };

    const handleToggleSelect = (queueId: string) => {
        setSelected(prev => (prev.includes(queueId) ? prev.filter(id => id !== queueId) : [...prev, queueId]));
    };

    const sorted = [...items].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    const allSelected = items.length > 0 && selected.length === items.length;
    const someSelected = selected.length > 0 && !allSelected;

    const handleToggleAll = () => {
        setSelected(allSelected ? [] : items.map(i => i.uuid));
    };

    // Initiate a bulk clear — check for active items first.
    const initiateClear = (uuids: string[] | null) => {
        const targets = uuids ?? items.map(i => i.uuid);
        const activeCount = items.filter(i => targets.includes(i.uuid) && i.status === 'downloading').length;

        if (activeCount > 0) {
            setPendingClear({ uuids, activeCount });
        } else {
            executeClear(uuids, false);
        }
    };

    const executeClear = (uuids: string[] | null, force: boolean) => {
        setBulkPending(true);
        setPendingClear(null);
        bulkClearQueue(uuid, uuids ?? undefined, force)
            .then(() => {
                const removedSet = new Set(uuids ?? items.map(i => i.uuid));
                setItems(prev => prev.filter(i => !removedSet.has(i.uuid)));
                setSelected([]);
            })
            .catch(() => {})
            .finally(() => setBulkPending(false));
    };

    if (loading) {
        return (
            <div css={tw`mt-8`}>
                <Spinner size={'large'} centered />
            </div>
        );
    }

    const counts = {
        downloading: items.filter(i => i.status === 'downloading').length,
        pending: items.filter(i => i.status === 'pending').length,
        failed: items.filter(i => i.status === 'failed').length,
        completed: items.filter(i => i.status === 'completed').length,
    };

    return (
        <div css={tw`flex flex-col gap-4`}>
            {/* Summary bar */}
            {items.length > 0 && (
                <div css={tw`flex flex-wrap gap-3`}>
                    {counts.downloading > 0 && (
                        <span
                            css={tw`flex items-center gap-1.5 text-xs bg-blue-500/20 text-blue-300 px-2.5 py-1 rounded-full`}
                        >
                            <FontAwesomeIcon icon={faCircleNotch} css={tw`animate-spin`} />
                            {counts.downloading} downloading
                        </span>
                    )}
                    {counts.pending > 0 && (
                        <span
                            css={tw`flex items-center gap-1.5 text-xs bg-neutral-700 text-neutral-300 px-2.5 py-1 rounded-full`}
                        >
                            <FontAwesomeIcon icon={faClock} />
                            {counts.pending} pending
                        </span>
                    )}
                    {counts.failed > 0 && (
                        <span
                            css={tw`flex items-center gap-1.5 text-xs bg-red-500/20 text-red-300 px-2.5 py-1 rounded-full`}
                        >
                            <FontAwesomeIcon icon={faXmark} />
                            {counts.failed} failed
                        </span>
                    )}
                    {counts.completed > 0 && (
                        <span
                            css={tw`flex items-center gap-1.5 text-xs bg-green-500/20 text-green-300 px-2.5 py-1 rounded-full`}
                        >
                            <FontAwesomeIcon icon={faCheck} />
                            {counts.completed} completed
                        </span>
                    )}
                    {hasActive && (
                        <span css={tw`ml-auto text-xs text-neutral-500 self-center`}>
                            Auto-refreshing every {POLL_INTERVAL_MS / 1000}s
                        </span>
                    )}
                </div>
            )}

            {/* Active-item warning / confirm prompt */}
            {pendingClear && (
                <div css={tw`flex items-start gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3`}>
                    <FontAwesomeIcon icon={faTriangleExclamation} css={tw`text-yellow-400 mt-0.5 flex-shrink-0`} />
                    <div css={tw`flex-1 min-w-0`}>
                        <p css={tw`text-sm text-yellow-300 font-medium`}>
                            {pendingClear.activeCount} item{pendingClear.activeCount !== 1 ? 's are' : ' is'} currently
                            downloading
                        </p>
                        <p css={tw`text-xs text-yellow-400/80 mt-0.5`}>
                            The queue entry will be removed but the active download may still finish in the background.
                        </p>
                    </div>
                    <div css={tw`flex items-center gap-2 flex-shrink-0`}>
                        <button
                            css={tw`text-xs text-neutral-400 hover:text-neutral-200 transition-colors px-2 py-1`}
                            onClick={() => setPendingClear(null)}
                        >
                            Cancel
                        </button>
                        <button
                            css={tw`text-xs bg-yellow-600 hover:bg-yellow-500 text-white px-3 py-1 rounded transition-colors`}
                            disabled={bulkPending}
                            onClick={() => executeClear(pendingClear.uuids, true)}
                        >
                            Clear Anyway
                        </button>
                    </div>
                </div>
            )}

            {/* Empty state */}
            {items.length === 0 && (
                <div css={tw`flex flex-col items-center gap-3 py-16 text-neutral-500`}>
                    <FontAwesomeIcon icon={faInbox} css={tw`text-4xl`} />
                    <p css={tw`text-sm`}>No downloads in the queue.</p>
                    <p css={tw`text-xs text-neutral-600`}>Completed items are cleared after 15 minutes.</p>
                </div>
            )}

            {/* Queue items */}
            {sorted.length > 0 && (
                <div css={tw`rounded-lg border border-neutral-700 overflow-hidden`}>
                    {/* Bulk action toolbar */}
                    <div css={tw`flex items-center gap-3 px-4 py-2.5 border-b border-neutral-700 bg-neutral-800/60`}>
                        {/* Select-all checkbox */}
                        <label css={tw`flex items-center gap-2 cursor-pointer select-none`}>
                            <Input
                                type="checkbox"
                                checked={allSelected}
                                ref={(el: HTMLInputElement | null) => {
                                    if (el) el.indeterminate = someSelected;
                                }}
                                onChange={handleToggleAll}
                                css={tw`cursor-pointer`}
                            />
                            <span css={tw`text-xs text-neutral-400`}>
                                {selected.length > 0 ? `${selected.length} selected` : 'Select all'}
                            </span>
                        </label>

                        <div css={tw`ml-auto flex items-center gap-2`}>
                            {selected.length > 0 && (
                                <button
                                    disabled={bulkPending || !!pendingClear}
                                    onClick={() => initiateClear(selected)}
                                    css={tw`flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors px-2 py-1 rounded hover:bg-red-500/10`}
                                >
                                    <FontAwesomeIcon
                                        icon={bulkPending ? faCircleNotch : faTrash}
                                        css={bulkPending ? tw`animate-spin` : undefined}
                                    />
                                    Clear selected ({selected.length})
                                </button>
                            )}
                            <button
                                disabled={bulkPending || !!pendingClear}
                                onClick={() => initiateClear(null)}
                                css={tw`flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors px-2 py-1 rounded hover:bg-neutral-700`}
                            >
                                <FontAwesomeIcon icon={faTrash} css={tw`text-xs`} />
                                Clear all
                            </button>
                        </div>
                    </div>

                    <div css={tw`divide-y divide-neutral-700`}>
                        {sorted.map(item => (
                            <QueueRow
                                key={item.uuid}
                                item={item}
                                actionPending={actionPending === item.uuid}
                                selected={selected.includes(item.uuid)}
                                onToggleSelect={() => handleToggleSelect(item.uuid)}
                                onCancel={() => handleCancel(item.uuid)}
                                onRetry={() => handleRetry(item.uuid)}
                                onDismiss={() => handleDismiss(item.uuid)}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

interface RowProps {
    item: QueueItem;
    actionPending: boolean;
    selected: boolean;
    onToggleSelect: () => void;
    onCancel: () => void;
    onRetry: () => void;
    onDismiss: () => void;
}

function QueueRow({ item, actionPending, selected, onToggleSelect, onCancel, onRetry, onDismiss }: RowProps) {
    const isModpackParent = item.source === 'modpack' && !item.parent_id;
    const label = item.file_name ?? (isModpackParent ? item.project_id : item.file_id);
    const sourceLabel = item.source === 'plugin' ? 'Plugin' : isModpackParent ? 'Modpack' : 'Mod';
    const addedAt = new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const [showLog, setShowLog] = useState(false);

    return (
        <>
            {showLog && item.install_log && (
                <LogModal
                    title={typeof label === 'string' ? label : 'Install log'}
                    log={item.install_log}
                    onClose={() => setShowLog(false)}
                />
            )}
            <div
                css={[
                    tw`flex items-center gap-3 px-4 py-3 hover:bg-neutral-800/50 transition-colors`,
                    selected && tw`bg-neutral-700/30`,
                ]}
            >
                {/* Checkbox */}
                <Input
                    type="checkbox"
                    checked={selected}
                    onChange={onToggleSelect}
                    css={tw`cursor-pointer flex-shrink-0`}
                />

                {/* Status icon */}
                <div css={tw`flex-shrink-0 w-5 text-center`}>
                    {item.status === 'downloading' && (
                        <FontAwesomeIcon icon={faCircleNotch} css={tw`text-blue-400 animate-spin`} />
                    )}
                    {item.status === 'pending' && <FontAwesomeIcon icon={faClock} css={tw`text-neutral-400`} />}
                    {item.status === 'completed' && <FontAwesomeIcon icon={faCheck} css={tw`text-green-400`} />}
                    {item.status === 'failed' && <FontAwesomeIcon icon={faXmark} css={tw`text-red-400`} />}
                </div>

                {/* Content */}
                <div css={tw`flex-1 min-w-0`}>
                    <p css={tw`text-sm text-neutral-200 truncate`} title={label}>
                        {label}
                    </p>
                    <p css={tw`text-xs text-neutral-500 capitalize`}>
                        {item.provider} &middot; {sourceLabel} &middot;{' '}
                        <span
                            css={[
                                item.status === 'downloading' && tw`text-blue-400`,
                                item.status === 'failed' && tw`text-red-400`,
                                item.status === 'completed' && tw`text-green-400`,
                            ]}
                        >
                            {statusLabel[item.status]}
                        </span>{' '}
                        &middot; queued at {addedAt}
                    </p>
                    {isModpackParent && (item.status === 'downloading' || item.status === 'pending') && (
                        <div css={tw`mt-0.5`}>
                            <p css={tw`text-xs text-neutral-400`}>{phaseLabel(item.phase)}</p>
                            {!!item.total_children && item.total_children > 0 && (
                                <>
                                    <p css={tw`text-xs text-neutral-500 mt-0.5`}>
                                        {Math.min(item.completed_children ?? 0, item.total_children)} /{' '}
                                        {item.total_children} mods
                                        {!!item.failed_children && item.failed_children > 0 && (
                                            <span css={tw`text-yellow-500`}> · {item.failed_children} failed</span>
                                        )}
                                    </p>
                                    <div css={tw`mt-1 h-1.5 w-full bg-neutral-700 rounded-full overflow-hidden`}>
                                        <div
                                            css={tw`h-full bg-blue-500 transition-all duration-300`}
                                            style={{
                                                width: `${Math.min(((item.completed_children ?? 0) / item.total_children) * 100, 100)}%`,
                                            }}
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                    {item.status === 'failed' && item.error_message && (
                        <p css={tw`text-xs text-red-400 mt-0.5 truncate`} title={item.error_message}>
                            {item.error_message}
                        </p>
                    )}
                    {isModpackParent &&
                        item.install_log &&
                        (item.status === 'completed' || item.status === 'failed') && (
                            <button
                                css={tw`text-xs text-neutral-400 hover:text-neutral-200 transition-colors mt-1 flex items-center gap-1`}
                                onClick={() => setShowLog(true)}
                            >
                                <FontAwesomeIcon icon={faFileLines} />
                                View install log
                            </button>
                        )}
                    {item.status === 'completed' && item.file_name && (
                        <p css={tw`text-xs text-green-500 mt-0.5 flex items-center gap-1`}>
                            <FontAwesomeIcon icon={faDownload} />
                            {item.file_name}
                        </p>
                    )}
                </div>

                {/* Actions */}
                <div css={tw`flex-shrink-0 flex gap-1`}>
                    {item.status === 'pending' && (
                        <button
                            css={tw`text-neutral-500 hover:text-red-400 transition-colors px-2 py-1 rounded text-xs`}
                            disabled={actionPending}
                            onClick={onCancel}
                            title="Cancel"
                        >
                            <FontAwesomeIcon icon={faXmark} />
                            <span css={tw`ml-1`}>Cancel</span>
                        </button>
                    )}
                    {item.status === 'failed' && (
                        <button
                            css={tw`text-neutral-500 hover:text-blue-400 transition-colors px-2 py-1 rounded text-xs`}
                            disabled={actionPending}
                            onClick={onRetry}
                            title="Retry"
                        >
                            <FontAwesomeIcon icon={faRotateRight} css={actionPending ? tw`animate-spin` : undefined} />
                            <span css={tw`ml-1`}>Retry</span>
                        </button>
                    )}
                    {item.status === 'completed' && (
                        <button
                            css={tw`text-neutral-600 hover:text-neutral-400 transition-colors px-2 py-1 rounded text-xs`}
                            onClick={onDismiss}
                            title="Dismiss"
                        >
                            <FontAwesomeIcon icon={faXmark} />
                        </button>
                    )}
                </div>
            </div>
        </>
    );
}

function LogModal({ title, log, onClose }: { title: string; log: string; onClose: () => void }) {
    return (
        <>
            <div css={tw`fixed inset-0 z-50 bg-black/80 backdrop-blur-sm`} onClick={onClose} />
            <div css={tw`fixed inset-0 z-50 flex items-center justify-center p-4`} onClick={e => e.stopPropagation()}>
                <div
                    css={tw`bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col`}
                >
                    <div css={tw`flex items-center justify-between px-5 py-3 border-b border-neutral-700`}>
                        <h2 css={tw`text-sm font-semibold text-neutral-100 truncate`} title={title}>
                            Install log · {title}
                        </h2>
                        <button css={tw`text-neutral-400 hover:text-neutral-200 transition-colors`} onClick={onClose}>
                            <FontAwesomeIcon icon={faXmark} />
                        </button>
                    </div>
                    <pre
                        css={tw`flex-1 overflow-auto p-4 text-xs text-neutral-300 font-mono whitespace-pre-wrap break-words`}
                    >
                        {log}
                    </pre>
                </div>
            </div>
        </>
    );
}
