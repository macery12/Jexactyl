import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, FileJson, Power, Upload } from 'lucide-react';
import { m } from '@/i18n';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
    updateBillingSetting,
    exportBillingConfiguration,
    importBillingConfiguration,
} from '@/api/adminBillingSettings';
import { SectionCard } from '@/components/ui/editorChrome';
import { patchBilling } from './patchBilling';

// Tab 4 — rare and hard to undo. Importing a config file rewrites the catalog
// and disabling the module takes the storefront down, so neither belongs next
// to the currency picker someone opens every week.
export default function AdvancedTab() {
    const { push } = useFlashes();
    const [disableOpen, setDisableOpen] = useState(false);

    const doExport = useMutation({
        mutationFn: () => exportBillingConfiguration(),
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const doImport = useMutation({
        mutationFn: async (file: File) => {
            const text = await file.text();
            const json = JSON.parse(text);
            await importBillingConfiguration(json, false, true);
        },
        onSuccess: () => push({ type: 'success', message: m['admin.billing.settings.config.imported']() }),
        onError: err =>
            push({
                type: 'error',
                message: firstError(err) ?? m['admin.billing.settings.config.importError'](),
            }),
    });

    const disableModule = useMutation({
        mutationFn: () => updateBillingSetting('enabled', false),
        onSuccess: () => {
            patchBilling({ enabled: false });
            push({ type: 'success', message: m['admin.billing.integrations.disabled']() });
            setDisableOpen(false);
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) doImport.mutate(file);
        e.target.value = '';
    };

    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SectionCard
                id="config"
                icon={FileJson}
                title={m['admin.billing.settings.config.title']()}
                desc={m['admin.billing.settings.config.desc']()}
            >
                <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" disabled={doExport.isPending} onClick={() => doExport.mutate()}>
                        {doExport.isPending ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                        {m['admin.billing.settings.config.export']()}
                    </Button>
                    <label className="inline-flex">
                        <input type="file" accept="application/json" className="hidden" onChange={onPickFile} />
                        <span className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-[var(--color-border-strong)] px-2.5 text-sm font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)]">
                            {doImport.isPending ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                            {m['admin.billing.settings.config.import']()}
                        </span>
                    </label>
                </div>
                <p className="text-xs leading-relaxed text-[var(--color-ink-faint)]">
                    {m['admin.billing.settings.config.hint']()}
                </p>
            </SectionCard>

            <SectionCard
                id="danger"
                icon={Power}
                title={m['admin.billing.integrations.danger.title']()}
                desc={m['admin.billing.integrations.danger.desc']()}
            >
                <Button variant="danger" size="sm" className="self-start" onClick={() => setDisableOpen(true)}>
                    {m['admin.billing.integrations.danger.disable']()}
                </Button>
            </SectionCard>

            <ConfirmDialog
                open={disableOpen}
                onClose={() => setDisableOpen(false)}
                title={m['admin.billing.integrations.danger.disableTitle']()}
                body={m['admin.billing.integrations.danger.disableBody']()}
                confirmLabel={m['admin.billing.integrations.danger.disable']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={disableModule.isPending}
                onConfirm={() => disableModule.mutate()}
            />
        </div>
    );
}
