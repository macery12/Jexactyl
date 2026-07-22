import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Database, HardDrive, Hash, Plug, Trash2 } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import {
    getInvoiceSettings,
    updateInvoiceSettings,
    testStorageConnection,
    type InvoiceSettings,
    type StorageDriver,
} from '@/api/adminBillingInvoices';
import { SectionCard, FieldRow, ToggleGroup, ToggleRow, SaveBar } from '@/components/ui/editorChrome';

// The extra storage-config keys we surface for the s3 / r2 drivers.
const STORAGE_KEYS: Record<StorageDriver, string[]> = {
    local: [],
    s3: ['endpoint', 'region', 'bucket', 'access_key', 'secret_key'],
    r2: ['account_id', 'bucket', 'access_key', 'secret_key'],
};

export default function InvoiceSettingsPage() {
    const qc = useQueryClient();
    const { push } = useFlashes();

    const { data, isLoading, isError } = useQuery({
        queryKey: ['admin', 'billing', 'invoice-settings'],
        queryFn: getInvoiceSettings,
    });

    const [form, setForm] = useState<InvoiceSettings | null>(null);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        if (data) setForm(data);
    }, [data]);

    const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(data), [form, data]);

    const set = <K extends keyof InvoiceSettings>(key: K, value: InvoiceSettings[K]) =>
        setForm(f => (f ? { ...f, [key]: value } : f));
    const setConfig = (key: string, value: string) =>
        setForm(f => (f ? { ...f, storageConfig: { ...(f.storageConfig ?? {}), [key]: value } } : f));

    const save = useMutation({
        mutationFn: (f: InvoiceSettings) =>
            updateInvoiceSettings({
                company_name: f.companyName,
                company_address: f.companyAddress,
                company_city: f.companyCity,
                company_state: f.companyState,
                company_zip: f.companyZip,
                company_country: f.companyCountry,
                company_logo_url: f.companyLogoUrl,
                company_tax_id: f.companyTaxId,
                invoice_prefix: f.invoicePrefix,
                auto_cleanup_enabled: f.autoCleanupEnabled,
                auto_cleanup_after_years: f.autoCleanupAfterYears,
                require_billing_address: f.requireBillingAddress,
                storage_driver: f.storageDriver,
                storage_config: f.storageConfig,
            }),
        onSuccess: updated => {
            qc.setQueryData(['admin', 'billing', 'invoice-settings'], updated);
            setForm(updated);
            push({ type: 'success', message: m['admin.billing.invoiceSettings.saved']() });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const testConn = useMutation({
        mutationFn: () => testStorageConnection(),
        onSuccess: res => push({ type: res.ok ? 'success' : 'error', message: res.message || m['admin.billing.invoiceSettings.storage.tested']() }),
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    if (isLoading || !form) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }
    if (isError) {
        return <p className="text-sm text-[var(--color-danger)]">{m['admin.billing.common.loadError']()}</p>;
    }

    const driverOptions = [
        { value: 'local', label: m['admin.billing.invoiceSettings.storage.local']() },
        { value: 's3', label: m['admin.billing.invoiceSettings.storage.s3']() },
        { value: 'r2', label: m['admin.billing.invoiceSettings.storage.r2']() },
    ];
    const configKeys = STORAGE_KEYS[form.storageDriver];
    const r2Pct = form.r2BytesLimit > 0 ? Math.min(100, (form.r2BytesUsed / form.r2BytesLimit) * 100) : 0;

    return (
        <form
            onSubmit={e => {
                e.preventDefault();
                if (dirty) save.mutate(form);
            }}
            className="flex flex-col gap-6"
        >
            <div>
                <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['admin.billing.invoiceSettings.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.billing.invoiceSettings.subtitle']()}</p>
            </div>

            <SectionCard id="company" icon={Building2} title={m['admin.billing.invoiceSettings.company.title']()} desc={m['admin.billing.invoiceSettings.company.desc']()}>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <FieldRow label={m['admin.billing.invoiceSettings.company.name']()}>
                        <Input value={form.companyName} onChange={e => set('companyName', e.target.value)} />
                    </FieldRow>
                    <FieldRow label={m['admin.billing.invoiceSettings.company.taxId']()}>
                        <Input value={form.companyTaxId ?? ''} onChange={e => set('companyTaxId', e.target.value || null)} />
                    </FieldRow>
                    <FieldRow label={m['admin.billing.invoiceSettings.company.address']()}>
                        <Input value={form.companyAddress} onChange={e => set('companyAddress', e.target.value)} />
                    </FieldRow>
                    <FieldRow label={m['admin.billing.invoiceSettings.company.city']()}>
                        <Input value={form.companyCity} onChange={e => set('companyCity', e.target.value)} />
                    </FieldRow>
                    <FieldRow label={m['admin.billing.invoiceSettings.company.state']()}>
                        <Input value={form.companyState} onChange={e => set('companyState', e.target.value)} />
                    </FieldRow>
                    <FieldRow label={m['admin.billing.invoiceSettings.company.zip']()}>
                        <Input value={form.companyZip} onChange={e => set('companyZip', e.target.value)} />
                    </FieldRow>
                    <FieldRow label={m['admin.billing.invoiceSettings.company.country']()}>
                        <Input value={form.companyCountry} onChange={e => set('companyCountry', e.target.value)} />
                    </FieldRow>
                    <FieldRow label={m['admin.billing.invoiceSettings.company.logo']()} desc={m['admin.billing.invoiceSettings.company.logoDesc']()}>
                        <Input value={form.companyLogoUrl ?? ''} onChange={e => set('companyLogoUrl', e.target.value || null)} placeholder="https://…" />
                    </FieldRow>
                </div>
            </SectionCard>

            <SectionCard id="numbering" icon={Hash} title={m['admin.billing.invoiceSettings.numbering.title']()} desc={m['admin.billing.invoiceSettings.numbering.desc']()}>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <FieldRow label={m['admin.billing.invoiceSettings.numbering.prefix']()}>
                        <Input value={form.invoicePrefix} onChange={e => set('invoicePrefix', e.target.value)} placeholder="INV-" />
                    </FieldRow>
                    <FieldRow label={m['admin.billing.invoiceSettings.numbering.sequence']()} desc={m['admin.billing.invoiceSettings.numbering.sequenceDesc']()}>
                        <Input value={String(form.invoiceSequence)} disabled />
                    </FieldRow>
                </div>
            </SectionCard>

            <SectionCard id="retention" icon={Trash2} title={m['admin.billing.invoiceSettings.retention.title']()} desc={m['admin.billing.invoiceSettings.retention.desc']()}>
                <ToggleGroup>
                    <ToggleRow
                        label={m['admin.billing.invoiceSettings.retention.autoCleanup']()}
                        desc={m['admin.billing.invoiceSettings.retention.autoCleanupDesc']()}
                        checked={form.autoCleanupEnabled}
                        onChange={next => set('autoCleanupEnabled', next)}
                    />
                </ToggleGroup>
                {form.autoCleanupEnabled && (
                    <FieldRow label={m['admin.billing.invoiceSettings.retention.years']()} desc={m['admin.billing.invoiceSettings.retention.yearsDesc']()}>
                        <Input
                            type="number"
                            min={1}
                            max={20}
                            value={String(form.autoCleanupAfterYears)}
                            className="max-w-[160px]"
                            onChange={e => set('autoCleanupAfterYears', parseInt(e.target.value, 10) || 0)}
                        />
                    </FieldRow>
                )}
            </SectionCard>

            <SectionCard
                id="storage"
                icon={form.storageDriver === 'local' ? HardDrive : Database}
                title={m['admin.billing.invoiceSettings.storage.title']()}
                desc={m['admin.billing.invoiceSettings.storage.desc']()}
                right={
                    form.storageDriver !== 'local' ? (
                        <Button type="button" variant="outline" size="sm" disabled={testConn.isPending} onClick={() => testConn.mutate()}>
                            {testConn.isPending ? <Spinner className="h-4 w-4" /> : <Plug className="h-4 w-4" />}
                            {m['admin.billing.invoiceSettings.storage.test']()}
                        </Button>
                    ) : undefined
                }
            >
                <FieldRow label={m['admin.billing.invoiceSettings.storage.driver']()}>
                    <Select value={form.storageDriver} onChange={v => set('storageDriver', v as StorageDriver)} options={driverOptions} />
                </FieldRow>

                {configKeys.length > 0 && (
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                        {configKeys.map(key => (
                            <FieldRow key={key} label={key} mono={key}>
                                <Input
                                    value={form.storageConfig?.[key] ?? ''}
                                    onChange={e => setConfig(key, e.target.value)}
                                />
                            </FieldRow>
                        ))}
                    </div>
                )}

                {form.storageDriver === 'r2' && form.r2BytesLimit > 0 && (
                    <div>
                        <div className="mb-1 flex items-center justify-between text-xs text-[var(--color-ink-muted)]">
                            <span>{m['admin.billing.invoiceSettings.storage.usage']()}</span>
                            <span>
                                {formatBytes(form.r2BytesUsed)} / {formatBytes(form.r2BytesLimit)}
                            </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                            <div
                                className={cn('h-full rounded-full', r2Pct >= 90 ? 'bg-[var(--color-danger)]' : 'bg-[var(--brand)]')}
                                style={{ width: `${r2Pct}%` }}
                            />
                        </div>
                    </div>
                )}
            </SectionCard>

            {dirty && <SaveBar dirty={dirty} saving={save.isPending} onDiscard={() => data && setForm(data)} />}
        </form>
    );
}
