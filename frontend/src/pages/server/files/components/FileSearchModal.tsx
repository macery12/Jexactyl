import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { File as FileIcon, Folder, Search } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { m } from '@/i18n';
import { firstError } from '@/lib/apiError';
import { formatBytes } from '@/lib/format';
import { searchFiles, type SearchResult } from '@/api/files';
import { encodePathSegments } from '../paths';

// Advanced recursive file search — only rendered on supercharged nodes. Ported
// from V1's FileSearchDialog (glob / regex / case-sensitive over Wings-RS).
export function FileSearchModal({
    uuid,
    serverId,
    directory,
    open,
    onClose,
}: {
    uuid: string;
    serverId: string;
    directory: string;
    open: boolean;
    onClose: () => void;
}) {
    const navigate = useNavigate();
    const push = useFlashes(s => s.push);
    const [pattern, setPattern] = useState('');
    const [glob, setGlob] = useState(true);
    const [regex, setRegex] = useState(false);
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [results, setResults] = useState<SearchResult[]>([]);
    const [searched, setSearched] = useState(false);

    const search = useMutation({
        mutationFn: () =>
            searchFiles(uuid, { root: directory, pattern, glob, regex, case_sensitive: caseSensitive }),
        onSuccess: data => {
            setResults(data);
            setSearched(true);
        },
        onError: (e: unknown) => push({ type: 'error', message: firstError(e) ?? m['common.states.genericError']() }),
    });

    const run = () => {
        if (!pattern.trim()) return;
        search.mutate();
    };

    const goTo = (r: SearchResult) => {
        const dir = r.is_file ? r.path.substring(0, r.path.lastIndexOf('/')) || '/' : r.path;
        onClose();
        navigate(`/server/${serverId}/files#${encodePathSegments(dir)}`);
    };

    return (
        <Modal open={open} onClose={onClose} title={m['server.files.search.title']()} size="lg">
            <div className="flex flex-col gap-4">
                <div className="flex gap-2">
                    <Input
                        autoFocus
                        value={pattern}
                        onChange={e => setPattern(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && run()}
                        placeholder={glob ? '*.log' : regex ? '\\.(log|txt)$' : 'filename'}
                    />
                    <Button size="sm" onClick={run} disabled={search.isPending || !pattern.trim()}>
                        {search.isPending ? <Spinner className="h-4 w-4" /> : <Search className="h-4 w-4" />}
                        {m['server.files.search.run']()}
                    </Button>
                </div>

                <div className="flex flex-wrap gap-5">
                    <label className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
                        <Switch
                            checked={glob}
                            onChange={v => {
                                setGlob(v);
                                if (v) setRegex(false);
                            }}
                        />
                        {m['server.files.search.glob']()}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
                        <Switch
                            checked={regex}
                            onChange={v => {
                                setRegex(v);
                                if (v) setGlob(false);
                            }}
                        />
                        {m['server.files.search.regex']()}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
                        <Switch checked={caseSensitive} onChange={setCaseSensitive} />
                        {m['server.files.search.caseSensitive']()}
                    </label>
                </div>

                {searched && (
                    <div className="max-h-[420px] overflow-y-auto rounded-[var(--radius-card)] border border-[var(--color-border)]">
                        {results.length === 0 ? (
                            <p className="p-4 text-center text-sm text-[var(--color-ink-faint)]">
                                {m['server.files.search.noResults']()}
                            </p>
                        ) : (
                            <div className="divide-y divide-[var(--color-border)]">
                                <div className="px-3 py-2 text-xs text-[var(--color-ink-faint)]">
                                    {m['server.files.search.resultCount']({ count: results.length })}
                                </div>
                                {results.map((r, i) => (
                                    <button
                                        key={i}
                                        onClick={() => goTo(r)}
                                        className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--color-surface-2)]"
                                    >
                                        {r.is_file ? (
                                            <FileIcon className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
                                        ) : (
                                            <Folder className="h-4 w-4 shrink-0 text-[var(--brand)]" />
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate font-mono text-sm text-[var(--color-ink)]">
                                                {r.path}/{r.name}
                                            </p>
                                            <p className="text-xs text-[var(--color-ink-faint)]">
                                                {formatBytes(r.size)}
                                                {r.modified && ` · ${new Date(r.modified).toLocaleString()}`}
                                            </p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
}
