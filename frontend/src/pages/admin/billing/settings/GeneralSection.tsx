import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Coins, FileJson, Gavel, Download, Upload } from 'lucide-react';
import { m } from '@/i18n';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { useBilling } from '@/state/billing';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import currencyDictionary from '@/assets/currency';
import { updateBillingSetting, exportBillingConfiguration, importBillingConfiguration } from '@/api/adminBillingSettings';
import { updateInvoiceSettings } from '@/api/adminBillingInvoices';
import { SectionCard, FieldRow, ToggleGroup, ToggleRow } from '@/components/ui/editorChrome';
import { patchBilling } from './patchBilling';

export default function GeneralSection() {
    const { push } = useFlashes();
    const { billing } = useBilling();
    const raw = billing as Record<string, any>;

    const currencyOptions = Object.keys(currencyDictionary).map(code => ({
        value: code,
        label: `${code} — ${currencyDictionary[code]!.name}`,
    }));

    const [cooldown, setCooldown] = useState(String(raw.plan_change_cooldown_hours ?? 72));
    const [terms, setTerms] = useState(billing.links?.terms ?? '');
    const [privacy, setPrivacy] = useState(billing.links?.privacy ?? '');
    const [requireAddress, setRequireAddress] = useState(Boolean(billing.require_billing_address));

    const changeCurrency = useMutation({
        mutationFn: async (code: string) => {
            const symbol = currencyDictionary[code]?.symbol ?? '$';
            await updateBillingSetting('currency:code', code);
            await updateBillingSetting('currency:symbol', symbol);
            return { code, symbol };
        },
        onSuccess: ({ code, symbol }) => {
            patchBilling({ currency: { code: code.toLowerCase(), symbol } });
            push({ type: 'success', message: m['admin.billing.settings.saved']() });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const saveCooldown = useMutation({
        mutationFn: (hours: number) => updateBillingSetting('plan_change_cooldown_hours', String(hours)),
        onSuccess: (_d, hours) => {
            patchBilling({ plan_change_cooldown_hours: hours });
            push({ type: 'success', message: m['admin.billing.settings.saved']() });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const saveLinks = useMutation({
        mutationFn: async () => {
            await updateBillingSetting('links:terms', terms);
            await updateBillingSetting('links:privacy', privacy);
        },
        onSuccess: () => {
            patchBilling({ links: { terms, privacy } });
            push({ type: 'success', message: m['admin.billing.settings.saved']() });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const toggleAddress = useMutation({
        mutationFn: (next: boolean) => updateInvoiceSettings({ require_billing_address: next }),
        onSuccess: (_d, next) => {
            patchBilling({ require_billing_address: next });
            push({ type: 'success', message: m['admin.billing.settings.saved']() });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

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

    const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) doImport.mutate(file);
        e.target.value = '';
    };

    const currentCode = (billing.currency?.code ?? 'USD').toUpperCase();

    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SectionCard id="general" icon={Coins} title={m['admin.billing.settings.general.title']()} desc={m['admin.billing.settings.general.desc']()}>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <FieldRow label={m['admin.billing.settings.currency.label']()}>
                        <Select value={currentCode} onChange={code => changeCurrency.mutate(code)} options={currencyOptions} disabled={changeCurrency.isPending} />
                    </FieldRow>
                    <FieldRow label={m['admin.billing.settings.cooldown.label']()} desc={m['admin.billing.settings.cooldown.hint']()}>
                        <div className="flex items-center gap-2">
                            <Input type="number" min={0} max={720} value={cooldown} className="w-24 px-3" onChange={e => setCooldown(e.target.value)} />
                            <Button variant="outline" size="sm" disabled={saveCooldown.isPending} onClick={() => saveCooldown.mutate(parseInt(cooldown, 10) || 0)}>
                                {saveCooldown.isPending ? <Spinner className="h-4 w-4" /> : null}
                                {m['common.actions.save']()}
                            </Button>
                        </div>
                    </FieldRow>
                </div>
                <ToggleGroup>
                    <ToggleRow
                        label={m['admin.billing.settings.customer.requireAddress']()}
                        desc={m['admin.billing.settings.customer.requireAddressDesc']()}
                        checked={requireAddress}
                        disabled={toggleAddress.isPending}
                        onChange={next => {
                            setRequireAddress(next);
                            toggleAddress.mutate(next);
                        }}
                    />
                </ToggleGroup>
            </SectionCard>

            <SectionCard
                id="legal"
                icon={Gavel}
                title={m['admin.billing.settings.legal.title']()}
                desc={m['admin.billing.settings.legal.desc']()}
                right={
                    <Button variant="outline" size="sm" disabled={saveLinks.isPending} onClick={() => saveLinks.mutate()}>
                        {saveLinks.isPending ? <Spinner className="h-4 w-4" /> : null}
                        {m['common.actions.save']()}
                    </Button>
                }
            >
                <FieldRow label={m['admin.billing.settings.legal.terms']()}>
                    <Input value={terms} onChange={e => setTerms(e.target.value)} placeholder="https://…/terms" />
                </FieldRow>
                <FieldRow label={m['admin.billing.settings.legal.privacy']()}>
                    <Input value={privacy} onChange={e => setPrivacy(e.target.value)} placeholder="https://…/privacy" />
                </FieldRow>
                <div className="flex items-center gap-2 border-t border-[var(--color-border)] pt-4">
                    <FileJson className="h-4 w-4 text-[var(--color-ink-faint)]" />
                    <span className="mr-auto text-xs text-[var(--color-ink-faint)]">{m['admin.billing.settings.config.title']()}</span>
                    <Button variant="ghost" size="sm" disabled={doExport.isPending} onClick={() => doExport.mutate()}>
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
            </SectionCard>
        </div>
    );
}
