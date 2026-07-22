import { m } from '@/i18n';
import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    X,
    Save,
    Undo2,
    RotateCcw,
    RefreshCw,
    Columns2,
    Code2,
    Eye,
    Monitor,
    Smartphone,
    Braces,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { cn } from '@/lib/cn';
import {
    getEmailTemplateSource,
    getEmailTemplatePreview,
    saveEmailTemplateSource,
    revertEmailTemplate,
    type EmailTemplateSummary,
} from '@/api/email';
import { TEMPLATES_KEY } from './TemplatesPage';

type ViewMode = 'split' | 'code' | 'preview';
type Device = 'desktop' | 'mobile';

// Fullscreen editor for a single email template. Left pane is the raw Blade
// source, right pane is the rendered preview (sample data). The preview reflects
// the saved template and refreshes on save/revert or via the manual button —
// matching the V1 flow, so no draft-render endpoint is needed. Variables can be
// click-inserted at the cursor from the reference rail.
export function TemplateEditorDialog({
    template,
    onClose,
}: {
    template: EmailTemplateSummary;
    onClose: () => void;
}) {
    const qc = useQueryClient();
    const push = useFlashes(s => s.push);
    const taRef = useRef<HTMLTextAreaElement>(null);

    const [content, setContent] = useState('');
    const [savedContent, setSavedContent] = useState('');
    const [isCustomized, setIsCustomized] = useState(template.is_customized);
    const [view, setView] = useState<ViewMode>('split');
    const [device, setDevice] = useState<Device>('desktop');
    const [showVars, setShowVars] = useState(true);
    const [confirmRevert, setConfirmRevert] = useState(false);

    const dirty = content !== savedContent;

    const sourceQ = useQuery({
        queryKey: ['admin', 'email', 'template-source', template.key],
        queryFn: () => getEmailTemplateSource(template.key),
        gcTime: 0,
    });

    const previewQ = useQuery({
        queryKey: ['admin', 'email', 'template-preview', template.key],
        queryFn: () => getEmailTemplatePreview(template.key),
        gcTime: 0,
    });

    // Seed the editor once the source arrives.
    useEffect(() => {
        if (sourceQ.data) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
            setContent(sourceQ.data.content);
            setSavedContent(sourceQ.data.content);
            setIsCustomized(sourceQ.data.is_customized);
        }
    }, [sourceQ.data]);

    const saveMut = useMutation({
        mutationFn: () => saveEmailTemplateSource(template.key, content),
        onSuccess: res => {
            setSavedContent(content);
            setIsCustomized(res.is_customized);
            qc.invalidateQueries({ queryKey: TEMPLATES_KEY });
            previewQ.refetch(); // reflect the saved changes
            push({ type: 'success', message: m['admin.email.templates.editor.saved']() });
        },
        onError: err =>
            push({ type: 'error', message: firstError(err) ?? m['admin.email.templates.editor.saveError']() }),
    });

    const revertMut = useMutation({
        mutationFn: () => revertEmailTemplate(template.key),
        onSuccess: res => {
            setConfirmRevert(false);
            setIsCustomized(res.is_customized);
            qc.invalidateQueries({ queryKey: TEMPLATES_KEY });
            sourceQ.refetch(); // reload the (now default) source into the editor
            previewQ.refetch();
            push({ type: 'success', message: m['admin.email.templates.editor.reverted']() });
        },
        onError: err =>
            push({ type: 'error', message: firstError(err) ?? m['admin.email.templates.editor.revertError']() }),
    });

    const insertVariable = (name: string) => {
        const ta = taRef.current;
        if (!ta) {
            setContent(c => c + name);
            return;
        }
        const start = ta.selectionStart ?? content.length;
        const end = ta.selectionEnd ?? content.length;
        const next = content.slice(0, start) + name + content.slice(end);
        setContent(next);
        // Restore focus + place caret after the inserted token.
        requestAnimationFrame(() => {
            ta.focus();
            const pos = start + name.length;
            ta.setSelectionRange(pos, pos);
        });
    };

    const requestClose = () => {
        if (dirty && !window.confirm(m['admin.email.templates.editor.unsavedConfirm']())) return;
        onClose();
    };

    const loading = sourceQ.isLoading || !sourceQ.data;

    const codePane = (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-[var(--color-border)]">
            <textarea
                ref={taRef}
                value={content}
                onChange={e => setContent(e.target.value)}
                spellCheck={false}
                wrap="off"
                className="min-h-0 flex-1 resize-none overflow-auto bg-[var(--color-canvas)] px-4 py-4 font-mono text-[13.5px] leading-6 text-[var(--color-ink)] focus:outline-none"
                placeholder={m['admin.email.templates.editor.codePlaceholder']()}
            />
        </div>
    );

    const previewPane = (
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-surface-2)]">
            {/* Stale-preview hint: the preview shows the saved version, so unsaved
                edits aren't reflected until save. */}
            {dirty && (
                <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[var(--color-warning)]/15 px-3 py-1 text-[11px] font-medium text-[var(--color-warning)] shadow">
                    {m['admin.email.templates.editor.previewStale']()}
                </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto p-4">
                <div
                    className={cn(
                        'mx-auto h-full transition-all',
                        device === 'mobile' ? 'max-w-[390px]' : 'max-w-[640px]',
                    )}
                >
                    {previewQ.isLoading ? (
                        <div className="flex h-full items-center justify-center">
                            <Spinner className="h-6 w-6" />
                        </div>
                    ) : (
                        <iframe
                            title={m['admin.email.templates.editor.previewTitle']()}
                            srcDoc={previewQ.data ?? ''}
                            sandbox=""
                            className="h-full min-h-[560px] w-full rounded-lg border border-[var(--color-border)] bg-white shadow-sm"
                        />
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <Dialog.Root open onOpenChange={next => !next && requestClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
                <Dialog.Content
                    onEscapeKeyDown={e => {
                        e.preventDefault();
                        requestClose();
                    }}
                    onInteractOutside={e => e.preventDefault()}
                    className="fixed inset-0 z-50 flex flex-col bg-[var(--color-canvas)] focus:outline-none"
                >
                    {/* Header */}
                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3">
                        <div className="min-w-0">
                            <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-[var(--color-ink)]">
                                <span className="truncate">{template.label}</span>
                                <span className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-ink-muted)]">
                                    {template.category}
                                </span>
                                {isCustomized && (
                                    <span className="shrink-0 rounded-full bg-[var(--brand)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--brand)]">
                                        {m['admin.email.templates.customized']()}
                                    </span>
                                )}
                            </Dialog.Title>
                            <Dialog.Description className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-ink-faint)]">
                                {template.key}
                            </Dialog.Description>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            {/* View mode toggle */}
                            <SegGroup>
                                <SegBtn active={view === 'code'} onClick={() => setView('code')} title={m['admin.email.templates.editor.viewCode']()}>
                                    <Code2 className="h-4 w-4" />
                                </SegBtn>
                                <SegBtn active={view === 'split'} onClick={() => setView('split')} title={m['admin.email.templates.editor.viewSplit']()}>
                                    <Columns2 className="h-4 w-4" />
                                </SegBtn>
                                <SegBtn active={view === 'preview'} onClick={() => setView('preview')} title={m['admin.email.templates.editor.viewPreview']()}>
                                    <Eye className="h-4 w-4" />
                                </SegBtn>
                            </SegGroup>

                            {/* Preview device toggle */}
                            {view !== 'code' && (
                                <SegGroup>
                                    <SegBtn active={device === 'desktop'} onClick={() => setDevice('desktop')} title={m['admin.email.templates.editor.desktop']()}>
                                        <Monitor className="h-4 w-4" />
                                    </SegBtn>
                                    <SegBtn active={device === 'mobile'} onClick={() => setDevice('mobile')} title={m['admin.email.templates.editor.mobile']()}>
                                        <Smartphone className="h-4 w-4" />
                                    </SegBtn>
                                </SegGroup>
                            )}

                            {view !== 'code' && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => previewQ.refetch()}
                                    disabled={previewQ.isFetching}
                                    title={m['admin.email.templates.editor.refresh']()}
                                >
                                    <RefreshCw className={cn('h-4 w-4', previewQ.isFetching && 'animate-spin')} />
                                </Button>
                            )}

                            <Button
                                variant={showVars ? 'secondary' : 'ghost'}
                                size="sm"
                                onClick={() => setShowVars(v => !v)}
                                title={m['admin.email.templates.editor.variables']()}
                            >
                                <Braces className="h-4 w-4" />
                            </Button>

                            <div className="mx-1 h-6 w-px bg-[var(--color-border)]" />

                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setConfirmRevert(true)}
                                disabled={!isCustomized || revertMut.isPending}
                                title={m['admin.email.templates.editor.revert']()}
                            >
                                <RotateCcw className="h-4 w-4" />
                                <span className="hidden sm:inline">{m['admin.email.templates.editor.revert']()}</span>
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setContent(savedContent)}
                                disabled={!dirty || saveMut.isPending}
                            >
                                <Undo2 className="h-4 w-4" />
                                <span className="hidden sm:inline">{m['common.actions.discard']()}</span>
                            </Button>
                            <Button size="sm" onClick={() => saveMut.mutate()} disabled={!dirty || saveMut.isPending}>
                                {saveMut.isPending ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                                {m['common.actions.save']()}
                            </Button>

                            <Dialog.Close asChild>
                                <button
                                    className="ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                                    aria-label={m['common.actions.close']()}
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </Dialog.Close>
                        </div>
                    </div>

                    {/* Body — capped + centered so it doesn't stretch across ultrawide displays. */}
                    {loading ? (
                        <div className="flex flex-1 items-center justify-center">
                            <Spinner className="h-8 w-8" />
                        </div>
                    ) : (
                        <div className="mx-auto flex min-h-0 w-full max-w-[1500px] flex-1">
                            <div className="flex min-h-0 flex-1">
                                {(view === 'code' || view === 'split') && codePane}
                                {(view === 'preview' || view === 'split') && previewPane}
                            </div>

                            {/* Variables rail */}
                            {showVars && (
                                <aside className="flex w-60 shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]">
                                    <div className="border-b border-[var(--color-border)] px-4 py-3">
                                        <h3 className="text-sm font-semibold text-[var(--color-ink)]">
                                            {m['admin.email.templates.editor.variables']()}
                                        </h3>
                                        <p className="mt-0.5 text-[11px] text-[var(--color-ink-muted)]">
                                            {m['admin.email.templates.editor.variablesHint']()}
                                        </p>
                                    </div>
                                    <div className="min-h-0 flex-1 overflow-y-auto p-2">
                                        {template.variables.length === 0 ? (
                                            <p className="px-2 py-3 text-xs text-[var(--color-ink-faint)]">
                                                {m['admin.email.templates.editor.noVariables']()}
                                            </p>
                                        ) : (
                                            <ul className="flex flex-col gap-1">
                                                {template.variables.map(v => (
                                                    <li key={v.name}>
                                                        <button
                                                            onClick={() => insertVariable(v.name)}
                                                            className="w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--color-surface-2)]"
                                                        >
                                                            <div className="flex items-center gap-1.5">
                                                                <code className="font-mono text-[12px] font-semibold text-[var(--brand)]">
                                                                    {v.name}
                                                                </code>
                                                                {v.required && (
                                                                    <span className="text-[var(--color-danger)]">*</span>
                                                                )}
                                                            </div>
                                                            <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-ink-muted)]">
                                                                {v.description}
                                                            </p>
                                                            <p className="mt-0.5 truncate text-[10px] text-[var(--color-ink-faint)]">
                                                                {m['admin.email.templates.editor.eg']()} {String(v.example)}
                                                            </p>
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                </aside>
                            )}
                        </div>
                    )}
                </Dialog.Content>
            </Dialog.Portal>

            <ConfirmDialog
                open={confirmRevert}
                onClose={() => setConfirmRevert(false)}
                title={m['admin.email.templates.editor.revertTitle']()}
                body={m['admin.email.templates.editor.revertBody']()}
                confirmLabel={m['admin.email.templates.editor.revert']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={revertMut.isPending}
                onConfirm={() => revertMut.mutate()}
            />
        </Dialog.Root>
    );
}

// Small segmented-control primitives — local to the editor toolbar.
function SegGroup({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-0.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] p-0.5">
            {children}
        </div>
    );
}

function SegBtn({
    active,
    onClick,
    title,
    children,
}: {
    active: boolean;
    onClick: () => void;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                active
                    ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm'
                    : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
            )}
        >
            {children}
        </button>
    );
}
