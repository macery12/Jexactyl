import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useQueryClient } from '@tanstack/react-query';
import { UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useFlashes } from '@/state/flashes';
import { m } from '@/i18n';
import { firstError } from '@/lib/apiError';
import { getFileUploadUrl } from '@/api/files';

// Upload files to the current directory via the daemon's signed upload URL.
// Includes a full-screen drag-and-drop overlay (matches V1's UploadButton).
export function UploadButton({ uuid, directory }: { uuid: string; directory: string }) {
    const inputRef = useRef<HTMLInputElement>(null);
    const qc = useQueryClient();
    const push = useFlashes(s => s.push);
    const [dragging, setDragging] = useState(false);
    const [uploading, setUploading] = useState(false);

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

    const submit = async (files: FileList) => {
        const list = Array.from(files);
        if (list.length === 0) return;
        if (list.some(f => !f.type && (!f.size || f.size === 4096))) {
            push({ type: 'error', message: m['server.files.folderUploadUnsupported']() });
            return;
        }

        setUploading(true);
        try {
            const url = await getFileUploadUrl(uuid);
            await Promise.all(
                list.map(file =>
                    axios.post(
                        url,
                        { files: file },
                        { headers: { 'Content-Type': 'multipart/form-data' }, params: { directory } },
                    ),
                ),
            );
            push({ type: 'success', message: m['server.files.uploaded']({ count: list.length }) });
            await qc.invalidateQueries({ queryKey: ['server-files', uuid] });
        } catch (e) {
            push({ type: 'error', message: firstError(e) ?? m['common.states.genericError']() });
        } finally {
            setUploading(false);
        }
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
            <Button
                variant="secondary"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
            >
                <UploadCloud className="h-4 w-4" />
                {uploading ? m['server.files.uploading']() : m['server.files.upload']()}
            </Button>
        </>
    );
}
