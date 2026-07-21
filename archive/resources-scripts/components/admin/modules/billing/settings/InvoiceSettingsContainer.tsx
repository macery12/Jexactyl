import { useEffect, useState } from 'react';
import { Form, Formik } from 'formik';
import useFlash from '@/plugins/useFlash';
import {
    InvoiceSettings,
    StorageUsage,
    getInvoiceSettings,
    updateInvoiceSettings,
    getStorageUsage,
    testStorageConnection,
} from '@/api/routes/admin/billing/invoices';
import AdminBox from '@/elements/AdminBox';
import FlashMessageRender from '@/elements/FlashMessageRender';
import Field from '@/elements/Field';
import Spinner from '@/elements/Spinner';
import Alert from '@/elements/alert/Alert';
import { Button } from '@/elements/button';
import {
    faBuilding,
    faCloud,
    faFileInvoice,
    faHardDrive,
    faRotate,
    faShieldHalved,
    faTrash,
} from '@fortawesome/free-solid-svg-icons';
import { useStoreState } from '@/state/hooks';

const R2_LIMIT_BYTES = 10_200_547_328; // 9.5 GiB

type InvoiceSettingsFormValues = {
    company_name: string;
    company_address: string;
    company_city: string;
    company_state: string;
    company_zip: string;
    company_country: string;
    company_logo_url: string;
    company_tax_id: string;
    invoice_prefix: string;
    invoice_sequence: number;
    auto_cleanup_enabled: boolean;
    auto_cleanup_after_years: number;
    storage_driver: 'local' | 's3' | 'r2';
    storage_config: Record<string, string>;
};

const COMPANY_FIELDS: Array<{ key: keyof InvoiceSettingsFormValues; label: string; description?: string }> = [
    { key: 'company_name', label: 'Company Name' },
    { key: 'company_address', label: 'Street Address' },
    { key: 'company_city', label: 'City' },
    { key: 'company_state', label: 'State / Province' },
    { key: 'company_zip', label: 'ZIP / Postal Code' },
    { key: 'company_country', label: 'Country' },
    { key: 'company_tax_id', label: 'Tax ID / VAT Number' },
    { key: 'company_logo_url', label: 'Logo URL', description: 'Used on generated PDF invoices.' },
    { key: 'invoice_prefix', label: 'Invoice Prefix', description: 'Examples: INV, BILL, ACME.' },
];

const S3_FIELDS = [
    {
        field: 'key',
        label: 'Access Key ID',
        placeholder: 'e.g. AKIAIOSFODNN7EXAMPLE',
        description: 'Found under IAM → Users → Security Credentials.',
    },
    {
        field: 'secret',
        label: 'Secret Access Key',
        placeholder: 'Paste your secret key here',
        description: 'Only shown once when the IAM key is created.',
    },
    {
        field: 'region',
        label: 'Region',
        placeholder: 'e.g. us-east-1',
        description: 'The AWS region your bucket is in.',
    },
    {
        field: 'bucket',
        label: 'Bucket Name',
        placeholder: 'e.g. my-invoices',
        description: 'The name of your S3 bucket.',
    },
] as const;

const R2_FIELDS = [
    {
        field: 'account_id',
        label: 'Account ID',
        placeholder: 'e.g. a1b2c3d4e5f6...',
        description: 'Found on the R2 overview page.',
    },
    {
        field: 'key',
        label: 'Access Key ID',
        placeholder: 'e.g. abc123def456...',
        description: 'Generated under R2 → Manage R2 API Tokens.',
    },
    {
        field: 'secret',
        label: 'Secret Access Key',
        placeholder: 'Paste your secret key here',
        description: 'Only shown once when the token is created.',
    },
    {
        field: 'bucket',
        label: 'Bucket Name',
        placeholder: 'e.g. my-invoices',
        description: 'The name of your R2 bucket.',
    },
    {
        field: 'endpoint',
        label: 'Endpoint URL',
        placeholder: 'https://{account_id}.r2.cloudflarestorage.com',
        description: 'Leave blank to auto-generate from Account ID, or use a custom domain.',
    },
] as const;

function toFormValues(settings: InvoiceSettings): InvoiceSettingsFormValues {
    return {
        company_name: settings.company_name ?? '',
        company_address: settings.company_address ?? '',
        company_city: settings.company_city ?? '',
        company_state: settings.company_state ?? '',
        company_zip: settings.company_zip ?? '',
        company_country: settings.company_country ?? '',
        company_logo_url: settings.company_logo_url ?? '',
        company_tax_id: settings.company_tax_id ?? '',
        invoice_prefix: settings.invoice_prefix ?? '',
        invoice_sequence: settings.invoice_sequence ?? 1,
        auto_cleanup_enabled: settings.auto_cleanup_enabled ?? false,
        auto_cleanup_after_years: settings.auto_cleanup_after_years ?? 0,
        storage_driver: settings.storage_driver,
        storage_config: settings.storage_config ?? {},
    };
}

function toPayload(values: InvoiceSettingsFormValues): Partial<InvoiceSettings> {
    return {
        company_name: values.company_name.trim(),
        company_address: values.company_address.trim(),
        company_city: values.company_city.trim(),
        company_state: values.company_state.trim(),
        company_zip: values.company_zip.trim(),
        company_country: values.company_country.trim(),
        company_logo_url: values.company_logo_url.trim() || null,
        company_tax_id: values.company_tax_id.trim() || null,
        invoice_prefix: values.invoice_prefix.trim(),
        invoice_sequence: values.invoice_sequence,
        auto_cleanup_enabled: values.auto_cleanup_enabled,
        auto_cleanup_after_years: values.auto_cleanup_after_years,
        storage_driver: values.storage_driver,
        storage_config: values.storage_config,
    };
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function TabButton({
    active,
    onClick,
    children,
    primary,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
    primary: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                active ? 'text-white' : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
            style={active ? { borderColor: primary } : undefined}
        >
            {children}
        </button>
    );
}

function CompanyTab({ invoiceSequence }: { invoiceSequence: number }) {
    return (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <AdminBox title="Company Info" icon={faBuilding}>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {COMPANY_FIELDS.slice(0, 7).map(field => (
                        <Field
                            key={field.key}
                            id={field.key}
                            name={field.key}
                            label={field.label}
                            description={field.description}
                            type="text"
                        />
                    ))}
                </div>
                <div className="mt-4">
                    <Field
                        id="company_logo_url"
                        name="company_logo_url"
                        label="Logo URL"
                        description="Used on generated PDF invoices."
                        type="text"
                    />
                </div>
            </AdminBox>

            <AdminBox title="Invoice Numbering" icon={faFileInvoice}>
                <div className="grid grid-cols-1 gap-4">
                    <Field
                        id="invoice_prefix"
                        name="invoice_prefix"
                        label="Invoice Prefix"
                        description="Examples: INV, BILL, ACME."
                        type="text"
                    />
                    <div className="rounded-md border border-neutral-700 bg-neutral-900/40 p-4">
                        <p className="text-sm font-medium text-neutral-200">Current sequence</p>
                        <p className="mt-1 font-mono text-lg text-neutral-100">#{invoiceSequence}</p>
                        <p className="mt-2 text-xs text-neutral-400">
                            Invoice numbering is global and never resets per year.
                        </p>
                    </div>
                </div>
            </AdminBox>
        </div>
    );
}

function StorageTab({
    usage,
    driver,
    setDriver,
    primary,
}: {
    usage: StorageUsage | null;
    driver: InvoiceSettingsFormValues['storage_driver'];
    setDriver: (driver: InvoiceSettingsFormValues['storage_driver']) => void;
    primary: string;
}) {
    const [testLoading, setTestLoading] = useState(false);
    const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

    const r2Percent = usage ? Math.min(100, (usage.r2_bytes_used / R2_LIMIT_BYTES) * 100) : 0;
    const r2Critical = r2Percent >= 90;

    return (
        <div className="flex flex-col gap-6">
            <AdminBox title="Storage Driver" icon={faHardDrive}>
                <div className="flex flex-wrap gap-3">
                    {(['local', 's3', 'r2'] as const).map(storageDriver => (
                        <button
                            key={storageDriver}
                            type="button"
                            onClick={() => {
                                setDriver(storageDriver);
                                setTestResult(null);
                                setTestLoading(false);
                            }}
                            className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                                driver === storageDriver
                                    ? 'border-neutral-600 bg-neutral-800 text-neutral-200'
                                    : 'border-neutral-700 bg-neutral-900 text-neutral-300'
                            }`}
                            style={driver === storageDriver ? { borderColor: primary } : undefined}
                        >
                            {storageDriver.toUpperCase()}
                        </button>
                    ))}
                </div>
            </AdminBox>

            <AdminBox title="Storage Configuration" icon={faCloud}>
                {usage === null && (
                    <p className="text-sm text-neutral-400">
                        Open this tab to load usage details and configuration guidance.
                    </p>
                )}
                {usage !== null && (
                    <div className="flex flex-col gap-4">
                        <div className="rounded-md border border-neutral-700 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-300">
                            {usage.local_bytes_used != null ? (
                                <>
                                    Local storage used by invoices:{' '}
                                    <span className="font-medium text-neutral-100">
                                        {formatBytes(usage.local_bytes_used)}
                                    </span>
                                </>
                            ) : (
                                <>
                                    Storage usage loaded for{' '}
                                    <span className="font-medium text-neutral-100">{usage.driver.toUpperCase()}</span>.
                                </>
                            )}
                        </div>
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-neutral-400">R2 usage</span>
                                <span className={r2Critical ? 'text-red-400' : 'text-neutral-300'}>
                                    {formatBytes(usage.r2_bytes_used)} / {formatBytes(R2_LIMIT_BYTES)} (
                                    {usage.r2_percent_used.toFixed(1)}%)
                                </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-700">
                                <div
                                    className={`h-full rounded-full transition-all ${r2Critical ? 'bg-red-500' : 'bg-blue-500'}`}
                                    style={{ width: `${r2Percent}%` }}
                                />
                            </div>
                            {r2Critical && (
                                <p className="text-xs text-red-400">
                                    Warning: Storage is above 90%. New invoice PDFs will be blocked at 9.5 GiB.
                                </p>
                            )}
                        </div>
                    </div>
                )}
            </AdminBox>

            <AdminBox title="Connection Test" icon={faRotate}>
                <div className="flex flex-col gap-4">
                    <p className="text-sm text-neutral-400">
                        Test the currently selected storage driver without saving the form.
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                        <Button.Text
                            type="button"
                            disabled={testLoading}
                            loading={testLoading}
                            onClick={() => {
                                setTestLoading(true);
                                setTestResult(null);
                                testStorageConnection()
                                    .then(res => setTestResult(res))
                                    .catch(err =>
                                        setTestResult({
                                            ok: false,
                                            message: err?.response?.data?.message ?? err.message ?? 'Test failed.',
                                        }),
                                    )
                                    .finally(() => setTestLoading(false));
                            }}
                        >
                            Test Connection
                        </Button.Text>
                        {testResult && (
                            <Alert type={testResult.ok ? 'success' : 'danger'} small>
                                {testResult.message}
                            </Alert>
                        )}
                    </div>
                </div>
            </AdminBox>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                {driver === 's3' && (
                    <AdminBox title="AWS S3" icon={faShieldHalved}>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            {S3_FIELDS.map(({ field, label, placeholder, description }) => (
                                <Field
                                    key={field}
                                    id={`storage_config.${field}`}
                                    name={`storage_config.${field}`}
                                    label={label}
                                    description={description}
                                    type={field === 'secret' ? 'password' : 'text'}
                                    placeholder={placeholder}
                                />
                            ))}
                        </div>
                    </AdminBox>
                )}

                {driver === 'r2' && (
                    <AdminBox title="Cloudflare R2" icon={faCloud}>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            {R2_FIELDS.map(({ field, label, placeholder, description }) => (
                                <Field
                                    key={field}
                                    id={`storage_config.${field}`}
                                    name={`storage_config.${field}`}
                                    label={label}
                                    description={description}
                                    type={field === 'secret' ? 'password' : 'text'}
                                    placeholder={placeholder}
                                />
                            ))}
                        </div>
                    </AdminBox>
                )}
            </div>
        </div>
    );
}

function RetentionTab() {
    return (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <AdminBox title="Data Retention" icon={faTrash}>
                <div className="grid grid-cols-1 gap-4">
                    <Field
                        id="auto_cleanup_enabled"
                        name="auto_cleanup_enabled"
                        type="checkbox"
                        label="Enable automatic cleanup"
                        description="Invoice data is stored forever by default. Enable this to delete snapshots older than a set number of years."
                    />
                    <Field
                        id="auto_cleanup_after_years"
                        name="auto_cleanup_after_years"
                        type="number"
                        label="Delete data after (years)"
                        description="Encrypted data snapshots older than this will be deleted. PDF cache is separate (24 h TTL always)."
                        min={1}
                        max={100}
                    />
                </div>
            </AdminBox>
        </div>
    );
}

export default () => {
    const { addFlash, clearFlashes } = useFlash();
    const [settings, setSettings] = useState<InvoiceSettings | null>(null);
    const [usage, setUsage] = useState<StorageUsage | null>(null);
    const [loadingUsage, setLoadingUsage] = useState(false);
    const [tab, setTab] = useState<'company' | 'storage' | 'retention'>('company');
    const { primary } = useStoreState(state => state.theme.data!.colors);

    useEffect(() => {
        getInvoiceSettings()
            .then(setSettings)
            .catch(() =>
                addFlash({ key: 'admin:invoice-settings', type: 'error', message: 'Failed to load invoice settings.' }),
            );
    }, []);

    useEffect(() => {
        if (tab !== 'storage' || usage || loadingUsage) return;

        setLoadingUsage(true);
        getStorageUsage()
            .then(setUsage)
            .catch(() => {})
            .finally(() => setLoadingUsage(false));
    }, [loadingUsage, tab, usage]);

    if (!settings) {
        return (
            <div className="flex min-h-48 items-center justify-center py-10">
                <Spinner size="large" centered />
            </div>
        );
    }

    return (
        <Formik
            enableReinitialize
            initialValues={toFormValues(settings)}
            onSubmit={async (values, { setSubmitting }) => {
                clearFlashes('admin:invoice-settings');
                try {
                    const updated = await updateInvoiceSettings(toPayload(values));
                    setSettings(updated);
                    addFlash({ key: 'admin:invoice-settings', type: 'success', message: 'Invoice settings saved.' });
                } catch (error: any) {
                    addFlash({
                        key: 'admin:invoice-settings',
                        type: 'error',
                        message: error?.message ?? 'Save failed.',
                    });
                } finally {
                    setSubmitting(false);
                }
            }}
        >
            {({ isSubmitting, values, setFieldValue }) => (
                <Form className="flex flex-col gap-6">
                    <div>
                        <h2 className="font-header text-xl font-medium text-neutral-50">Invoice Settings</h2>
                        <p className="text-sm text-neutral-400">
                            Configure company details, storage driver, and retention policy for invoices.
                        </p>
                    </div>

                    <FlashMessageRender byKey="admin:invoice-settings" className="mb-2" />

                    <div className="flex border-b border-neutral-700">
                        <TabButton primary={primary} active={tab === 'company'} onClick={() => setTab('company')}>
                            Company Info
                        </TabButton>
                        <TabButton primary={primary} active={tab === 'storage'} onClick={() => setTab('storage')}>
                            Storage
                        </TabButton>
                        <TabButton primary={primary} active={tab === 'retention'} onClick={() => setTab('retention')}>
                            Retention
                        </TabButton>
                    </div>

                    {tab === 'company' && <CompanyTab invoiceSequence={values.invoice_sequence} />}

                    {tab === 'storage' && (
                        <StorageTab
                            primary={primary}
                            usage={loadingUsage ? null : usage}
                            driver={values.storage_driver}
                            setDriver={nextDriver => setFieldValue('storage_driver', nextDriver)}
                        />
                    )}

                    {tab === 'retention' && <RetentionTab />}

                    <div className="flex justify-end">
                        <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
                            Save Changes
                        </Button>
                    </div>
                </Form>
            )}
        </Formik>
    );
};
