import { useState } from 'react';
import { abs } from '@/lib/base';
import { ShieldHalf, Info } from 'lucide-react';
import { m } from '@/i18n';
import { Input, Field } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ModuleCard, useModuleSave } from './ModuleCard';
import { toggleAuthModule, updateJGuardSettings, type JGuardSettingsValues } from '@/api/adminAuth';

type Mode = 'manual' | 'delayed';

// Human-readable delay summary (e.g. "2 hours", "1h 30m") from a minute count.
function formatDelay(minutes: number): string {
    if (minutes <= 0) return m['admin.auth.jguard.delayInstant']();
    if (minutes < 60) return m['admin.auth.jguard.delayMinutes']({ count: minutes });
    if (minutes % 60 === 0) return m['admin.auth.jguard.delayHours']({ count: minutes / 60 });
    return m['admin.auth.jguard.delayMixed']({ hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

export default function JGuardSettingsPage() {
    const { status, run } = useModuleSave();
    const auth = window.EverestConfiguration?.auth;
    const jguard = auth?.modules.jguard;

    const [mode, setMode] = useState<Mode>(jguard?.approval_mode === 'delayed' ? 'delayed' : 'manual');
    const [delay, setDelay] = useState<number>(jguard?.delay ?? 60);
    const [pendingMessage, setPendingMessage] = useState<string>(jguard?.pending_message ?? '');
    const [confirmDisable, setConfirmDisable] = useState(false);
    const [disabling, setDisabling] = useState(false);

    const save = (values: JGuardSettingsValues) => run(() => updateJGuardSettings(values));

    return (
        <div className="flex max-w-2xl flex-col gap-5">
            <ConfirmDialog
                open={confirmDisable}
                onClose={() => setConfirmDisable(false)}
                title={m['admin.auth.jguard.disableTitle']()}
                body={m['admin.auth.jguard.disableBody']()}
                confirmLabel={m['admin.auth.jguard.disableConfirm']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={disabling}
                onConfirm={async () => {
                    setDisabling(true);
                    try {
                        await toggleAuthModule('disable', 'jguard');
                        window.location.assign(abs('/admin/auth'));
                    } catch {
                        setDisabling(false);
                        setConfirmDisable(false);
                    }
                }}
            />

            <ModuleCard icon={ShieldHalf} title={m['admin.auth.jguard.title']()} subtitle={m['admin.auth.jguard.subtitle']()} status={status}>
                <Field label={m['admin.auth.jguard.modeLabel']()} htmlFor="jguard-mode">
                    <Select
                        id="jguard-mode"
                        value={mode}
                        onChange={value => {
                            const next = value as Mode;
                            setMode(next);
                            save({ approval_mode: next });
                        }}
                        options={[
                            { value: 'manual', label: m['admin.auth.jguard.modeManual']() },
                            { value: 'delayed', label: m['admin.auth.jguard.modeDelayed']() },
                        ]}
                    />
                    <p className="text-xs text-[var(--color-ink-faint)]">{m['admin.auth.jguard.modeHelp']()}</p>
                </Field>

                {mode === 'delayed' && (
                    <Field label={m['admin.auth.jguard.delayLabel']()} htmlFor="jguard-delay">
                        <Input
                            id="jguard-delay"
                            type="number"
                            min={0}
                            value={delay}
                            onChange={e => setDelay(parseInt(e.target.value, 10) || 0)}
                            onBlur={() => save({ delay: Math.max(0, delay) })}
                        />
                        <p className="text-xs text-[var(--color-ink-faint)]">
                            {m['admin.auth.jguard.delayHelp']({ summary: formatDelay(delay) })}
                        </p>
                    </Field>
                )}

                <Field label={m['admin.auth.jguard.messageLabel']()} htmlFor="jguard-message">
                    <Textarea
                        id="jguard-message"
                        rows={3}
                        maxLength={500}
                        value={pendingMessage}
                        placeholder={m['admin.auth.jguard.messagePlaceholder']()}
                        onChange={e => setPendingMessage(e.target.value)}
                        onBlur={() => save({ pending_message: pendingMessage })}
                    />
                    <p className="text-xs text-[var(--color-ink-faint)]">{m['admin.auth.jguard.messageHelp']()}</p>
                </Field>

                <div className="border-t border-[var(--color-border)] pt-4">
                    <Button variant="danger" size="sm" onClick={() => setConfirmDisable(true)}>
                        {m['admin.auth.jguard.disableButton']()}
                    </Button>
                </div>
            </ModuleCard>

            <div className="flex items-start gap-2.5 rounded-xl border border-[var(--brand)]/25 bg-[var(--brand)]/8 px-4 py-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand)]" />
                <p className="text-xs text-[var(--color-ink-muted)]">
                    {mode === 'manual'
                        ? m['admin.auth.jguard.manualNote']()
                        : m['admin.auth.jguard.delayedNote']({ summary: formatDelay(delay) })}
                </p>
            </div>
        </div>
    );
}
