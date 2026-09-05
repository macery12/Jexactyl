import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useQueryClient } from '@tanstack/react-query';
import { UploadCloud, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useFlashes } from '@/state/flashes';
import { m } from '@/i18n/messages';
import { firstError } from '@/lib/apiError';
import { formatBytes } from '@/lib/format';
import { getFileUploadUrl } from '@/api/files';

interface Upload {
    name: string;
    loaded: number;
    total: number;
    controller: AbortController;
    done: boolean;
    error: boolean;
}

// Upload files to the current directory via the daemon's signed upload URL.
// Shows a per-file progress list with cancel (restores V1's upload feedback,
// which V2 had dropped down to a greyed-out button) plus a drag-and-drop overlay.
export function UploadButton({ uuid, directory }: { uuid: string; directory: string }) {
    const inputRef = useRef<HTMLInputElement>(null);
    const qc = useQueryClient();
    const push = useFlashes(s => s.push);
    const [dragging, setDragging] = useState(false);
    const [uploads, setUploads] = useState<Record<string, Upload>>({});

    const active = Object.values(uploads);
    const uploading = active.some(u => !u.done && !u.error);

    useEffect(() => {
        const isFiles = (e: DragEvent) =>
            Array.from(e.dataTransfer?.types ?? []).some(t => t.toLowerCase() === 'files');
        const onEnter = (e: DragEvent) => {
            if (isFiles(e)) {
                e.preventDefault();
                setDragging(true);
            }
        };
        const onExit = () => setDragging(false);
        window.addEventListener('dragenter', onEnter, { capture: true });
        window.addEventListener('dragexit', onExit, { capture: true });
        return () => {
            window.removeEventListener('dragenter', onEnter, { capture: true } as EventListenerOptions);
            window.removeEventListener('dragexit', onExit, { capture: true } as EventListenerOptions);
        };
    }, []);

    const patch = (name: string, next: Partial<Upload>) =>
        setUploads(prev => (prev[name] ? { ...prev, [name]: { ...prev[name], ...next } } : prev));

    const cancel = (name: string) => {
        setUploads(prev => {
            prev[name]?.controller.abort();
            const { [name]: _removed, ...rest } = prev;
            return rest;
        });
    };

    const clearFinished = () =>
        setUploads(prev => Object.fromEntries(Object.entries(prev).filter(([, u]) => !u.done && !u.error)));

    const submit = async (files: FileList) => {
        const list = Array.from(files);
        if (list.length === 0) return;
        if (list.some(f => !f.type && (!f.size || f.size === 4096))) {
            push({ type: 'error', message: m['server.files.folderUploadUnsupported']() });
            return;
        }

        let url: string;
        try {
            url = await getFileUploadUrl(uuid);
        } catch (e) {
            push({ type: 'error', message: firstError(e) ?? m['common.states.genericError']() });
            return;
        }

        const started = list.map(file => ({ file, controller: new AbortController() }));
        setUploads(prev => {
            const next = { ...prev };
            for (const { file, controller } of started) {
                next[file.name] = { name: file.name, loaded: 0, total: file.size, controller, done: false, error: false };
            }
            return next;
        });

        const results = await Promise.allSettled(
            started.map(({ file, controller }) =>
                axios
                    .post(
                        url,
                        { files: file },
                        {
                            headers: { 'Content-Type': 'multipart/form-data' },
                            params: { directory },
                            signal: controller.signal,
                            onUploadProgress: e =>
                                patch(file.name, { loaded: e.loaded, total: e.total ?? file.size }),
                        },
                    )
                    .then(() => patch(file.name, { done: true, loaded: file.size }))
                    .catch(err => {
                        // A user-cancelled upload is already removed from state; don't flag it.
                        if (axios.isCancel(err)) throw err;
                        patch(file.name, { error: true });
                        throw err;
                    }),
            ),
        );

        const ok = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(
            r => r.status === 'rejected' && !axios.isCancel((r as PromiseRejectedResult).reason),
        ).length;
        if (ok > 0) {
            push({ type: 'success', message: m['server.files.uploaded']({ count: ok }) });
            await qc.invalidateQueries({ queryKey: ['server-files', uuid] });
        }
        if (failed > 0) push({ type: 'error', message: m['server.files.uploadFailed']({ count: failed }) });
        // Auto-clear the tray shortly after everything settles.
        setTimeout(clearFinished, 2500);
    };

    return (
        <>
            {dragging && (
                <div
                    className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onDragOver={e => e.preventDefault()}
                    onDragLeave={() => setDragging(false)}
                    onDrop={e => {
                        e.preventDefault();
                        setDragging(false);
                        if (e.dataTransfer?.files.length) void submit(e.dataTransfer.files);
                    }}
                >
                    <div className="flex items-center gap-4 rounded-[var(--radius-card)] border-2 border-dashed border-[var(--brand)] bg-[var(--color-surface)] px-8 py-6">
                        <UploadCloud className="h-9 w-9 text-[var(--brand)]" />
                        <p className="text-lg font-semibold text-[var(--color-ink)]">
                            {m['server.files.dropToUpload']()}
                        </p>
                    </div>
                </div>
            )}

            {/* Progress tray — one row per file, with a live bar and cancel. */}
            {active.length > 0 && (
                <div className="fixed bottom-6 right-6 z-[65] w-80 max-w-[calc(100vw-3rem)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-2xl shadow-black/40">
                    <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
                        <span className="text-sm font-semibold text-[var(--color-ink)]">
                            {m['server.files.upload']()}
                        </span>
                        <button
                            onClick={clearFinished}
                            className="text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
                            aria-label={m['common.actions.close']()}
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="max-h-64 space-y-2.5 overflow-y-auto p-4">
                        {active.map(u => {
                            const pct = u.done ? 100 : u.total > 0 ? Math.round((u.loaded / u.total) * 100) : 0;
                            return (
                                <div key={u.name}>
                                    <div className="flex items-center justify-between gap-2 text-xs">
                                        <span className="min-w-0 flex-1 truncate text-[var(--color-ink-muted)]">
                                            {u.name}
                                        </span>
                                        {u.error ? (
                                            <span className="text-[var(--color-danger)]">
                                                {m['server.files.uploadRowFailed']()}
                                            </span>
                                        ) : u.done ? (
                                            <span className="text-[var(--color-success)]">{formatBytes(u.total)}</span>
                                        ) : (
                                            <button
                                                onClick={() => cancel(u.name)}
                                                className="text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-danger)]"
                                                aria-label={m['common.actions.cancel']()}
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </div>
                                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                                        <div
                                            className={`h-full rounded-full transition-[width] duration-200 ${
                                                u.error ? 'bg-[var(--color-danger)]' : 'bg-[var(--brand)]'
                                            }`}
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={e => {
                    if (e.currentTarget.files) void submit(e.currentTarget.files);
                    e.currentTarget.value = '';
                }}
            />
            <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
                <UploadCloud className="h-4 w-4" />
                {uploading ? m['server.files.uploading']() : m['server.files.upload']()}
            </Button>
        </>
    );
}
