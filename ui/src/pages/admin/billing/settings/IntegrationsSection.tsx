import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CreditCard, KeyRound, Power, Wallet } from 'lucide-react';
import { m } from '@/i18n';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { useBilling } from '@/state/billing';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { updateBillingSetting, deleteStripeKeys } from '@/api/adminBillingSettings';
import { SectionCard, ToggleGroup, ToggleRow } from '../editorChrome';
import { patchBilling } from './patchBilling';

function StatusChip({ ok }: { ok: boolean }) {
    return (
        <span
            className={
                'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ' +
                (ok
                    ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent)]/12 text-[var(--color-accent)]'
                    : 'border-[var(--color-danger)]/30 bg-[var(--color-danger)]/12 text-[var(--color-danger)]')
            }
        >
            {ok ? m['admin.billing.integrations.configured']() : m['admin.billing.integrations.notConfigured']()}
        </span>
    );
}

function StripeKeysModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { push } = useFlashes();
    const { billing } = useBilling();
    const [publishable, setPublishable] = useState('');
    const [secret, setSecret] = useState('');

    const save = useMutation({
        mutationFn: async () => {
            await updateBillingSetting('keys:publishable', publishable.trim());
            await updateBillingSetting('keys:secret', secret.trim());
        },
        onSuccess: () => {
            patchBilling({
                processors: { ...((billing.processors ?? {}) as any), stripe: { available: true, enabled: true } },
            });
            push({ type: 'success', message: m['admin.billing.integrations.stripe.saved']() });
            onClose();
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const valid = publishable.trim().startsWith('pk_') && secret.trim().startsWith('sk_');

    return (
        <Modal open={open} onClose={onClose} title={m['admin.billing.integrations.stripe.modalTitle']()} description={m['admin.billing.integrations.stripe.modalDesc']()}>
            <form
                onSubmit={e => {
                    e.preventDefault();
                    if (valid) save.mutate();
                }}
                className="flex flex-col gap-4"
            >
                <Field label={m['admin.billing.integrations.stripe.publishable']()} hint={m['admin.billing.integrations.stripe.publishableHint']()}>
                    <Input value={publishable} onChange={e => setPublishable(e.target.value)} placeholder="pk_test_51Ab…" />
                </Field>
                <Field label={m['admin.billing.integrations.stripe.secret']()} hint={m['admin.billing.integrations.stripe.secretHint']()}>
                    <Input value={secret} onChange={e => setSecret(e.target.value)} placeholder="sk_test_51Ab…" />
                </Field>
                <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-4">
                    <Button type="button" variant="ghost" onClick={onClose}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button type="submit" disabled={!valid || save.isPending}>
                        {save.isPending && <Spinner className="h-4 w-4" />}
                        {m['common.actions.save']()}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}

function PayPalKeysModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { push } = useFlashes();
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [mode, setMode] = useState<'sandbox' | 'live'>('sandbox');

    const save = useMutation({
        mutationFn: async () => {
            await updateBillingSetting('paypal_standalone:client_id', clientId.trim());
            await updateBillingSetting('paypal_standalone:client_secret', clientSecret.trim());
            await updateBillingSetting('paypal_standalone:mode', mode);
        },
        onSuccess: () => {
            push({ type: 'success', message: m['admin.billing.integrations.paypal.saved']() });
            onClose();
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const valid = clientId.trim().length > 10 && clientSecret.trim().length > 10;
    const modeOptions = [
        { value: 'sandbox', label: m['admin.billing.integrations.paypal.sandbox']() },
        { value: 'live', label: m['admin.billing.integrations.paypal.live']() },
    ];

    return (
        <Modal open={open} onClose={onClose} title={m['admin.billing.integrations.paypal.modalTitle']()} description={m['admin.billing.integrations.paypal.modalDesc']()}>
            <form
                onSubmit={e => {
                    e.preventDefault();
                    if (valid) save.mutate();
                }}
                className="flex flex-col gap-4"
            >
                <Field label={m['admin.billing.integrations.paypal.mode']()}>
                    <Select value={mode} onChange={v => setMode(v as 'sandbox' | 'live')} options={modeOptions} />
                </Field>
                <Field label={m['admin.billing.integrations.paypal.clientId']()}>
                    <Input value={clientId} onChange={e => setClientId(e.target.value)} placeholder={m['admin.billing.integrations.paypal.clientIdPlaceholder']()} />
                </Field>
                <Field label={m['admin.billing.integrations.paypal.clientSecret']()}>
                    <Input value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder={m['admin.billing.integrations.paypal.clientSecretPlaceholder']()} />
                </Field>
                <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-4">
                    <Button type="button" variant="ghost" onClick={onClose}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button type="submit" disabled={!valid || save.isPending}>
                        {save.isPending && <Spinner className="h-4 w-4" />}
                        {m['common.actions.save']()}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}

export default function IntegrationsSection() {
    const { push } = useFlashes();
    const { billing } = useBilling();
    const raw = billing as Record<string, any>;

    const [stripeOpen, setStripeOpen] = useState(false);
    const [paypalOpen, setPaypalOpen] = useState(false);
    const [deleteKeysOpen, setDeleteKeysOpen] = useState(false);
    const [disableOpen, setDisableOpen] = useState(false);

    const stripeConfigured = Boolean(raw.processors?.stripe?.available ?? (raw.keys?.publishable && raw.keys?.secret));
    const stripeEnabled = Boolean(raw.integrations?.stripe?.enabled);
    const paypalStandaloneConfigured = Boolean(raw.processors?.paypal?.available);
    const paypalStandaloneEnabled = Boolean(raw.integrations?.paypal?.enabled);
    const paypalViaStripe = Boolean(raw.paypal);
    const linkEnabled = Boolean(raw.link);

    // Flat key/value toggle (paypal / link, both routed through Stripe).
    const toggleFlat = useMutation({
        mutationFn: ({ key, value }: { key: string; value: boolean }) => updateBillingSetting(key, value),
        onSuccess: (_d, { key, value }) => {
            patchBilling({ [key]: value });
            push({ type: 'success', message: m['admin.billing.settings.saved']() });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    // Nested integrations:<id>:enabled master toggle.
    const toggleIntegration = useMutation({
        mutationFn: ({ id, value }: { id: 'stripe' | 'paypal'; value: boolean }) =>
            updateBillingSetting(`integrations:${id}:enabled`, value),
        onSuccess: (_d, { id, value }) => {
            patchBilling({ integrations: { ...(raw.integrations ?? {}), [id]: { ...(raw.integrations?.[id] ?? {}), enabled: value } } });
            push({ type: 'success', message: m['admin.billing.settings.saved']() });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const delKeys = useMutation({
        mutationFn: () => deleteStripeKeys(),
        onSuccess: () => {
            setDeleteKeysOpen(false);
            window.location.reload();
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
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

    const busy = toggleFlat.isPending || toggleIntegration.isPending;

    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Stripe — includes Link + PayPal-via-Stripe as sub-methods */}
            <SectionCard
                id="integrations"
                icon={CreditCard}
                title={m['admin.billing.integrations.stripe.title']()}
                desc={m['admin.billing.integrations.stripe.desc']()}
                right={<StatusChip ok={stripeConfigured} />}
            >
                <ToggleGroup>
                    <ToggleRow
                        label={m['admin.billing.integrations.stripe.enable']()}
                        desc={m['admin.billing.integrations.stripe.enableDesc']()}
                        checked={stripeEnabled}
                        disabled={busy}
                        onChange={next => toggleIntegration.mutate({ id: 'stripe', value: next })}
                    />
                    <ToggleRow
                        label={m['admin.billing.integrations.paypalStripe.enable']()}
                        desc={m['admin.billing.integrations.paypalStripe.enableDesc']()}
                        checked={paypalViaStripe}
                        disabled={busy}
                        onChange={next => toggleFlat.mutate({ key: 'paypal', value: next })}
                    />
                    <ToggleRow
                        label={m['admin.billing.integrations.link.enable']()}
                        desc={m['admin.billing.integrations.link.enableDesc']()}
                        checked={linkEnabled}
                        disabled={busy}
                        onChange={next => toggleFlat.mutate({ key: 'link', value: next })}
                    />
                </ToggleGroup>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setStripeOpen(true)}>
                        <KeyRound className="h-4 w-4" />
                        {stripeConfigured ? m['admin.billing.integrations.stripe.update']() : m['admin.billing.integrations.stripe.add']()}
                    </Button>
                    {stripeConfigured && (
                        <Button variant="ghost" size="sm" onClick={() => setDeleteKeysOpen(true)}>
                            {m['admin.billing.integrations.stripe.delete']()}
                        </Button>
                    )}
                </div>
            </SectionCard>

            {/* PayPal — standalone, direct integration (not via Stripe) */}
            <SectionCard icon={Wallet} title={m['admin.billing.integrations.paypal.title']()} desc={m['admin.billing.integrations.paypal.desc']()} right={<StatusChip ok={paypalStandaloneConfigured} />}>
                <ToggleGroup>
                    <ToggleRow
                        label={m['admin.billing.integrations.paypal.enable']()}
                        desc={m['admin.billing.integrations.paypal.enableDesc']()}
                        checked={paypalStandaloneEnabled}
                        disabled={busy}
                        onChange={next => toggleIntegration.mutate({ id: 'paypal', value: next })}
                    />
                </ToggleGroup>
                <Button variant="outline" size="sm" className="self-start" onClick={() => setPaypalOpen(true)}>
                    <KeyRound className="h-4 w-4" />
                    {paypalStandaloneConfigured ? m['admin.billing.integrations.paypal.update']() : m['admin.billing.integrations.paypal.add']()}
                </Button>
            </SectionCard>

            {/* Disable module — spans full width */}
            <div className="lg:col-span-2">
                <SectionCard icon={Power} title={m['admin.billing.integrations.danger.title']()} desc={m['admin.billing.integrations.danger.desc']()}>
                    <Button variant="danger" size="sm" className="self-start" onClick={() => setDisableOpen(true)}>
                        {m['admin.billing.integrations.danger.disable']()}
                    </Button>
                </SectionCard>
            </div>

            <StripeKeysModal open={stripeOpen} onClose={() => setStripeOpen(false)} />
            <PayPalKeysModal open={paypalOpen} onClose={() => setPaypalOpen(false)} />

            <ConfirmDialog
                open={deleteKeysOpen}
                onClose={() => setDeleteKeysOpen(false)}
                title={m['admin.billing.integrations.stripe.deleteTitle']()}
                body={m['admin.billing.integrations.stripe.deleteBody']()}
                confirmLabel={m['admin.billing.integrations.stripe.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={delKeys.isPending}
                onConfirm={() => delKeys.mutate()}
            />
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
