import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Cog, ServerCog, Info, Copy, Check, AlertTriangle, Trash2 } from 'lucide-react';
import { m } from '@/i18n';
import { can } from '@/lib/can';
import { formatMib } from '@/lib/format';
import { useServer } from '@/components/server/ServerContext';
import { useServerSocket } from '@/state/serverSocket';
import { useFlags } from '@/state/flags';
import { useFlashes } from '@/state/flashes';
import { renameServer, reinstallServer, scheduleDeletion, cancelDeletion } from '@/api/serverSettings';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export default function SettingsPage() {
    const server = useServer();
    const held = server.permissions;
    const canRename = can(held, 'settings.rename');
    const canReinstall = can(held, 'settings.reinstall');
    const billingEnabled = useFlags(s => s.everest?.billing?.enabled ?? false);

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['server.settings.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['server.settings.subtitle']()}</p>
            </div>

            <GeneralCard canRename={canRename} />
            <ServerInfoCard />
            {(canReinstall || billingEnabled) && <ActionsCard canReinstall={canReinstall} billingEnabled={billingEnabled} />}
        </div>
    );
}

function SectionCard({
    icon: Icon,
    title,
    desc,
    danger,
    children,
}: {
    icon: typeof Cog;
    title: string;
    desc: string;
    danger?: boolean;
    children: React.ReactNode;
}) {
    return (
        <section
            className={`rounded-[var(--radius-card)] border bg-[var(--color-surface)]/70 ${
                danger ? 'border-[var(--color-danger)]/40' : 'border-[var(--color-border-strong)]'
            }`}
        >
            <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-3.5">
                <div
                    className={`flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] ${
                        danger ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink-muted)]'
                    }`}
                >
                    <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h2>
                    <p className="text-xs text-[var(--color-ink-faint)]">{desc}</p>
                </div>
            </header>
            <div className="p-5">{children}</div>
        </section>
    );
}

function GeneralCard({ canRename }: { canRename: boolean }) {
    const server = useServer();
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const [name, setName] = useState(server.name);
    const [description, setDescription] = useState(server.description ?? '');

    const save = useMutation({
        mutationFn: () => renameServer(server.uuid, name.trim(), description.trim() || undefined),
        onSuccess: () => {
            push({ type: 'success', message: m['server.settings.renamed']() });
            qc.invalidateQueries({ queryKey: ['server', server.id] });
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const dirty = name.trim() !== server.name || description.trim() !== (server.description ?? '');

    return (
        <SectionCard icon={Cog} title={m['server.settings.general.title']()} desc={m['server.settings.general.desc']()}>
            {!canRename ? (
                <p className="text-sm text-[var(--color-ink-muted)]">{m['server.settings.general.noPermission']()}</p>
            ) : (
                <div className="flex max-w-xl flex-col gap-4">
                    <Field label={m['server.settings.general.name']()} htmlFor="server-name">
                        <Input id="server-name" value={name} onChange={e => setName(e.target.value)} />
                    </Field>
                    <Field label={m['server.settings.general.description']()} htmlFor="server-desc">
                        <Textarea
                            id="server-desc"
                            rows={2}
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder={m['server.settings.general.descriptionPlaceholder']()}
                        />
                    </Field>
                    <div>
                        <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending || name.trim().length === 0}>
                            {save.isPending && <Spinner className="h-4 w-4" />}
                            {m['common.actions.saveChanges']()}
                        </Button>
                    </div>
                </div>
            )}
        </SectionCard>
    );
}

function ServerInfoCard() {
    const server = useServer();
    const limit = (mib: number) => (mib === 0 ? m['common.states.unlimited']() : formatMib(mib));

    return (
        <SectionCard icon={Info} title={m['server.settings.info.title']()} desc={m['server.settings.info.desc']()}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <CopyField label={m['server.settings.info.uuid']()} value={server.uuid} />
                <CopyField label={m['server.settings.info.id']()} value={server.id} />
                <InfoField label={m['server.settings.info.node']()} value={server.node} />
                <InfoField label={m['server.settings.info.image']()} value={server.dockerImage || '—'} mono />
                <InfoField label={m['server.settings.info.memory']()} value={limit(server.limits.memory)} />
                <InfoField label={m['server.settings.info.disk']()} value={limit(server.limits.disk)} />
                <InfoField
                    label={m['server.settings.info.cpu']()}
                    value={server.limits.cpu === 0 ? m['common.states.unlimited']() : `${server.limits.cpu}%`}
                />
            </div>
        </SectionCard>
    );
}

function InfoField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">{label}</span>
            <p
                className={`mt-1.5 truncate rounded-md border border-[var(--color-border)] px-3 py-2.5 text-sm text-[var(--color-ink)] ${
                    mono ? 'font-mono text-xs' : ''
                }`}
            >
                {value}
            </p>
        </div>
    );
}

function CopyField({ label, value }: { label: string; value: string }) {
    const [copied, setCopied] = useState(false);
    const copy = () =>
        navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    return (
        <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">{label}</span>
            <button
                onClick={copy}
                className="group mt-1.5 flex w-full items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-2)]"
            >
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-[var(--color-ink)]">{value}</span>
                {copied ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" />
                ) : (
                    <Copy className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
                )}
            </button>
        </div>
    );
}

function ActionsCard({ canReinstall, billingEnabled }: { canReinstall: boolean; billingEnabled: boolean }) {
    const server = useServer();
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const status = useServerSocket(s => s.status);
    const isStopped = status === null || status === 'offline';

    const [reinstallOpen, setReinstallOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [cancelOpen, setCancelOpen] = useState(false);

    const reinstall = useMutation({
        mutationFn: () => reinstallServer(server.uuid),
        onSuccess: () => {
            push({ type: 'success', message: m['server.settings.reinstallStarted']() });
            setReinstallOpen(false);
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const schedule = useMutation({
        mutationFn: () => scheduleDeletion(server.uuid),
        onSuccess: () => {
            push({ type: 'success', message: m['server.settings.deletionScheduled']() });
            setDeleteOpen(false);
            qc.invalidateQueries({ queryKey: ['server', server.id] });
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const cancel = useMutation({
        mutationFn: () => cancelDeletion(server.uuid),
        onSuccess: () => {
            push({ type: 'success', message: m['server.settings.deletionCanceled']() });
            setCancelOpen(false);
            qc.invalidateQueries({ queryKey: ['server', server.id] });
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    return (
        <SectionCard icon={ServerCog} title={m['server.settings.actions.title']()} desc={m['server.settings.actions.desc']()} danger>
            <div className="flex flex-col gap-5">
                {canReinstall && (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-[var(--color-ink)]">{m['server.settings.actions.reinstall']()}</p>
                            <p className="text-xs text-[var(--color-ink-faint)]">{m['server.settings.actions.reinstallDesc']()}</p>
                            {!isStopped && (
                                <p className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--color-warning)]">
                                    <AlertTriangle className="h-3.5 w-3.5" /> {m['server.settings.actions.mustStop']()}
                                </p>
                            )}
                        </div>
                        <Button variant="danger" onClick={() => setReinstallOpen(true)} disabled={!isStopped || reinstall.isPending}>
                            {m['server.settings.actions.reinstall']()}
                        </Button>
                    </div>
                )}

                {billingEnabled && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-5">
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-[var(--color-ink)]">{m['server.settings.actions.deletion']()}</p>
                            <p className="text-xs text-[var(--color-ink-faint)]">{m['server.settings.actions.deletionDesc']()}</p>
                        </div>
                        {server.isDeletionScheduled ? (
                            <Button variant="outline" onClick={() => setCancelOpen(true)} disabled={cancel.isPending}>
                                {m['server.settings.actions.cancelDeletion']()}
                            </Button>
                        ) : (
                            <Button variant="danger" onClick={() => setDeleteOpen(true)} disabled={schedule.isPending}>
                                <Trash2 className="h-4 w-4" /> {m['server.settings.actions.scheduleDeletion']()}
                            </Button>
                        )}
                    </div>
                )}
            </div>

            <ConfirmDialog
                open={reinstallOpen}
                onClose={() => setReinstallOpen(false)}
                title={m['server.settings.reinstallTitle']()}
                body={m['server.settings.reinstallBody']()}
                confirmLabel={m['server.settings.actions.reinstall']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={reinstall.isPending}
                onConfirm={() => reinstall.mutate()}
            />
            <ConfirmDialog
                open={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                title={m['server.settings.deletionTitle']()}
                body={m['server.settings.deletionBody']()}
                confirmLabel={m['server.settings.actions.scheduleDeletion']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={schedule.isPending}
                onConfirm={() => schedule.mutate()}
            />
            <ConfirmDialog
                open={cancelOpen}
                onClose={() => setCancelOpen(false)}
                title={m['server.settings.cancelDeletionTitle']()}
                body={m['server.settings.cancelDeletionBody']()}
                confirmLabel={m['server.settings.actions.cancelDeletion']()}
                cancelLabel={m['common.actions.cancel']()}
                danger={false}
                busy={cancel.isPending}
                onConfirm={() => cancel.mutate()}
            />
        </SectionCard>
    );
}
