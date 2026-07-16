import { useState } from 'react';
import { UploadCloud, ClipboardPaste } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { importEgg } from '@/api/adminNests';
import { CodeEditor } from './egg/CodeEditor';

export function ImportEggModal({ nestId, onClose, onImported }: { nestId: number; onClose: () => void; onImported: () => void }) {
    const push = useFlashes(s => s.push);
    const [mode, setMode] = useState<'upload' | 'paste'>('upload');
    const [file, setFile] = useState<File | null>(null);
    const [pasted, setPasted] = useState('');
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        setSaving(true);
        try {
            const raw = mode === 'upload' ? (file ? await file.text() : '') : pasted;
            if (!raw.trim()) {
                push({ type: 'error', message: m['admin.nests.import.noContent']() });
                return;
            }
            const json = JSON.parse(raw);
            await importEgg(nestId, json);
            push({ type: 'success', message: m['admin.nests.import.imported']() });
            onImported();
            onClose();
        } catch (err) {
            if (err instanceof SyntaxError) {
                push({ type: 'error', message: m['admin.nests.import.invalidJson']() });
            } else {
                push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open
            onClose={onClose}
            title={m['admin.nests.import.title']()}
            description={m['admin.nests.import.desc']()}
            size="lg"
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={submit} disabled={saving}>
                        {saving && <Spinner className="h-4 w-4" />}
                        {m['admin.nests.import.action']()}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <div className="flex gap-2">
                    <Button variant={mode === 'upload' ? 'secondary' : 'ghost'} size="sm" onClick={() => setMode('upload')}>
                        <UploadCloud className="h-4 w-4" /> {m['admin.nests.import.upload']()}
                    </Button>
                    <Button variant={mode === 'paste' ? 'secondary' : 'ghost'} size="sm" onClick={() => setMode('paste')}>
                        <ClipboardPaste className="h-4 w-4" /> {m['admin.nests.import.paste']()}
                    </Button>
                </div>

                {mode === 'upload' ? (
                    <label
                        className={cn(
                            'flex cursor-pointer flex-col items-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/30 px-6 py-10 text-center',
                        )}
                    >
                        <UploadCloud className="h-8 w-8 text-[var(--color-ink-faint)]" />
                        <span className="text-sm text-[var(--color-ink-muted)]">{m['admin.nests.import.dropHint']()}</span>
                        <span className="text-xs text-[var(--color-ink-faint)]">
                            {file ? file.name : m['admin.nests.import.noFile']()}
                        </span>
                        <input
                            type="file"
                            accept=".json"
                            className="hidden"
                            onChange={e => setFile(e.target.files?.[0] ?? null)}
                        />
                    </label>
                ) : (
                    <CodeEditor value={pasted} onChange={setPasted} language="JSON" height="18rem" />
                )}
            </div>
        </Modal>
    );
}
