import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Copy, CreditCard, KeyRound, Wallet, Webhook, type LucideIcon } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { useBilling } from '@/state/billing';
import type { BillingConfig } from '@/lib/globals';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { updateBillingSetting, deleteStripeKeys } from '@/api/adminBillingSettings';
import { SectionCard, ToggleGroup, ToggleRow } from '@/components/ui/editorChrome';
import { patchBilling } from './patchBilling';

type WebhookSetupData = NonNullable<BillingConfig['webhook_setup']>;

interface WebhookProps {
    provider: string;
    url: string;
    events: string[];
    description: string;
    note?: string;
}

const PANEL_LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink)]';

// The host is context; the path is the part that differs per provider and gets
// mistyped. Dimming the origin makes the endpoint read as a structured value
// rather than a sentence someone typed into the page.
function splitUrl(url: string): { origin: string; path: string } {
    try {
        const parsed = new URL(url);
        return { origin: parsed.origin, path: `${parsed.pathname}${parsed.search}` };
    } catch {
        return { origin: '', path: url };
    }
}

// Setup detail, inline in the provider card. It sat behind a dialog only because
// the card used to be half-width and clipped the URL mid-path; a full-width card
// fits the whole endpoint, so the one thing an admin comes here to copy is on
// screen without a click. No "endpoint ready" or event-count line — the Panel
// can't observe whether the provider ever calls the endpoint, so a green
// summary would only be restating that the route exists.
function WebhookPanel({ provider, url, events, description, note }: WebhookProps) {
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
    const { origin, path } = splitUrl(url);

    const copy = async () => {
        try {
            if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
            await navigator.clipboard.writeText(url);
            setCopyState('copied');
        } catch {
            setCopyState('failed');
        }
    };

    return (
        <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] p-4">
            <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink-muted)]">
                    <Webhook className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-ink)]">
                        {m['admin.billing.integrations.webhook.title']()}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-faint)]">{description}</p>
                </div>
            </div>

            <div>
                <span className={PANEL_LABEL}>{m['admin.billing.integrations.webhook.url']()}</span>
                {/* Wraps instead of scrolling: an admin copying this by hand needs to
                    read the whole path, not just the part that fits on one line. */}
                <div className="mt-1.5 flex items-start gap-3 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-canvas)]/60 px-3 py-2.5">
                    <code className="min-w-0 flex-1 select-all break-all font-mono text-[13px] leading-relaxed tracking-[-0.01em]">
                        <span className="text-[var(--color-ink-muted)]">{origin}</span>
                        <span className="font-medium text-[var(--color-ink)]">{path}</span>
                    </code>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="-my-1 shrink-0"
                        onClick={copy}
                        aria-label={m['admin.billing.integrations.webhook.copyUrl']({ provider })}
                    >
                        {copyState === 'copied' ? (
                            <Check className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                        ) : (
                            <Copy className="h-3.5 w-3.5" />
                        )}
                        {copyState === 'copied' ? m['common.states.copied']() : m['common.actions.copy']()}
                    </Button>
                </div>
                <p
                    className={copyState === 'failed' ? 'mt-1.5 text-xs text-[var(--color-danger)]' : 'sr-only'}
                    role="status"
                    aria-live="polite"
                >
                    {copyState === 'copied'
                        ? m['admin.billing.integrations.webhook.copied']({ provider })
                        : copyState === 'failed'
                          ? m['admin.billing.integrations.webhook.copyFailed']()
                          : ''}
                </p>
            </div>

            <div>
                <span className={PANEL_LABEL}>{m['admin.billing.integrations.webhook.events']()}</span>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {events.map(event => (
                        <li key={event}>
                            <code className="inline-flex rounded-md border border-[var(--color-border-strong)] bg-[var(--color-canvas)]/60 px-2 py-1 font-mono text-[11px] tracking-[-0.01em] text-[var(--color-ink)]">
                                {event}
                            </code>
                        </li>
                    ))}
                </ul>
            </div>

            {note && <p className="text-xs leading-relaxed text-[var(--color-ink-faint)]">{note}</p>}
        </div>
    );
}

// Three states, not two. "Switched on but holding no API keys" is the one that
// looks fine in a boolean and takes payments nowhere, so it gets its own colour.
type ProviderState = 'live' | 'needsKeys' | 'off';

const STATE_STYLE: Record<ProviderState, { pill: string; dot: string; icon: string }> = {
    live: {
        pill: 'border-[var(--color-accent)]/35 bg-[var(--color-accent)]/12 text-[var(--color-accent)]',
        dot: 'bg-[var(--color-accent)]',
        icon: 'border-[var(--color-accent)]/30 bg-[var(--color-accent)]/12 text-[var(--color-accent)]',
    },
    needsKeys: {
        pill: 'border-[var(--color-warning)]/35 bg-[var(--color-warning)]/12 text-[var(--color-warning)]',
        dot: 'bg-[var(--color-warning)]',
        icon: 'border-[var(--color-warning)]/30 bg-[var(--color-warning)]/12 text-[var(--color-warning)]',
    },
    off: {
        pill: 'border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]',
        dot: 'bg-[var(--color-ink-faint)]',
        icon: 'border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-ink-faint)]',
    },
};

const stateLabel: Record<ProviderState, () => string> = {
    live: m['admin.billing.integrations.state.live'],
    needsKeys: m['admin.billing.integrations.state.needsKeys'],
    off: m['admin.billing.integrations.state.off'],
};

function StatusPill({ state }: { state: ProviderState }) {
    const style = STATE_STYLE[state];

    return (
        <span
            className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                style.pill,
            )}
        >
            <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
            {stateLabel[state]()}
        </span>
    );
}

// Switcher and status board in one. Whether a provider takes payments is the
// first thing an admin comes here to check, so it's readable without opening
// anything — and only the selected provider's settings render below, instead of
// both stacked down the page.
function ProviderTile({
    icon: Icon,
    name,
    state,
    meta,
    selected,
    onSelect,
}: {
    icon: LucideIcon;
    name: string;
    state: ProviderState;
    meta: string;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            onClick={onSelect}
            className={cn(
                'flex items-start gap-3 rounded-[var(--radius-card)] border p-4 text-left transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60',
                selected
                    ? 'border-[var(--brand)]/60 bg-[var(--brand)]/12'
                    : 'border-[var(--color-border-strong)] bg-[var(--color-surface-2)] hover:border-[var(--brand)]/40',
            )}
        >
            <span
                className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
                    STATE_STYLE[state].icon,
                )}
            >
                <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-[var(--color-ink)]">{name}</span>
                    <StatusPill state={state} />
                </span>
                <span className="mt-1 block truncate text-xs text-[var(--color-ink-muted)]">{meta}</span>
            </span>
        </button>
    );
}

// The provider's on/off switch, in the card header rather than buried as the
// first row of a toggle list next to the methods that depend on it.
function MasterToggle({
    checked,
    disabled,
    label,
    onChange,
}: {
    checked: boolean;
    disabled?: boolean;
    label: string;
    onChange: (next: boolean) => void;
}) {
    return (
        <span className="flex items-center gap-2.5">
            <span
                className={cn(
                    'text-xs font-semibold uppercase tracking-wide',
                    checked ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-faint)]',
                )}
            >
                {checked ? m['common.states.enabled']() : m['common.states.disabled']()}
            </span>
            <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />
        </span>
    );
}

// Labelled sub-section of a provider card, so methods / keys / webhook read as
// three steps instead of one undifferentiated column.
function Block({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <span className={PANEL_LABEL}>{label}</span>
            <div className="mt-1.5">{children}</div>
        </div>
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
                keys: { publishable: true, secret: true },
                processors: {
                    ...((billing.processors ?? {}) as any),
                    stripe: {
                        available: Boolean(billing.processors?.stripe?.enabled),
                        enabled: Boolean(billing.processors?.stripe?.enabled),
                    },
                },
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

function PayPalKeysModal({
    open,
    onClose,
    initialMode,
}: {
    open: boolean;
    onClose: () => void;
    initialMode: 'sandbox' | 'live';
}) {
    const { push } = useFlashes();
    const { billing } = useBilling();
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [mode, setMode] = useState<'sandbox' | 'live'>(initialMode);

    const save = useMutation({
        mutationFn: async () => {
            await updateBillingSetting('paypal_standalone:client_id', clientId.trim());
            await updateBillingSetting('paypal_standalone:client_secret', clientSecret.trim());
            await updateBillingSetting('paypal_standalone:mode', mode);
        },
        onSuccess: () => {
            patchBilling({
                paypal_standalone: { ...billing.paypal_standalone, mode, credentials_configured: true },
                processors: {
                    ...((billing.processors ?? {}) as any),
                    paypal: {
                        available: Boolean(billing.processors?.paypal?.enabled),
                        enabled: Boolean(billing.processors?.paypal?.enabled),
                    },
                },
            });
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

// Tab 3 — the only tab that touches secrets: which providers are switched on,
// what credentials they hold, and where their webhooks point. Disabling the
// module lives on the Advanced tab.
export default function PaymentsTab() {
    const { push } = useFlashes();
    const { billing } = useBilling();
    const raw = billing as Record<string, any>;

    const [selected, setSelected] = useState<'stripe' | 'paypal'>('stripe');
    const [stripeOpen, setStripeOpen] = useState(false);
    const [paypalOpen, setPaypalOpen] = useState(false);
    const [deleteKeysOpen, setDeleteKeysOpen] = useState(false);

    const webhookSetup = raw.webhook_setup as WebhookSetupData | undefined;
    const stripeConfigured = Boolean(raw.keys?.publishable && raw.keys?.secret);
    const stripeEnabled = Boolean(raw.integrations?.stripe?.enabled);
    const paypalStandaloneConfigured = Boolean(
        raw.paypal_standalone?.credentials_configured ?? raw.processors?.paypal?.available,
    );
    const paypalStandaloneEnabled = Boolean(raw.integrations?.paypal?.enabled);
    const paypalMode: 'sandbox' | 'live' = raw.paypal_standalone?.mode === 'live' ? 'live' : 'sandbox';
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

    const busy = toggleFlat.isPending || toggleIntegration.isPending;

    const stripeState: ProviderState = !stripeEnabled ? 'off' : stripeConfigured ? 'live' : 'needsKeys';
    const paypalState: ProviderState = !paypalStandaloneEnabled ? 'off' : paypalStandaloneConfigured ? 'live' : 'needsKeys';

    // Stripe fronts three switchable methods (cards, PayPal-via-Stripe, Link);
    // PayPal has one, so its tile reports the account mode instead — sandbox
    // credentials in a live store is the mistake worth surfacing early.
    const keysMeta = (configured: boolean) =>
        configured ? m['admin.billing.integrations.keysSet']() : m['admin.billing.integrations.keysMissing']();
    const stripeMeta = `${m['admin.billing.integrations.methodsOn']({
        on: [stripeEnabled, paypalViaStripe, linkEnabled].filter(Boolean).length,
        total: 3,
    })} · ${keysMeta(stripeConfigured)}`;
    const paypalMeta = `${
        paypalMode === 'live'
            ? m['admin.billing.integrations.paypal.live']()
            : m['admin.billing.integrations.paypal.sandbox']()
    } · ${keysMeta(paypalStandaloneConfigured)}`;

    return (
        <div className="flex flex-col gap-6">
            {/* Status board doubles as the switcher — see ProviderTile. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="group" aria-label={m['admin.billing.integrations.providersAria']()}>
                <ProviderTile
                    icon={CreditCard}
                    name={m['admin.billing.integrations.stripe.title']()}
                    state={stripeState}
                    meta={stripeMeta}
                    selected={selected === 'stripe'}
                    onSelect={() => setSelected('stripe')}
                />
                <ProviderTile
                    icon={Wallet}
                    name={m['admin.billing.integrations.paypal.title']()}
                    state={paypalState}
                    meta={paypalMeta}
                    selected={selected === 'paypal'}
                    onSelect={() => setSelected('paypal')}
                />
            </div>

            {/* Stripe — includes Link + PayPal-via-Stripe as sub-methods */}
            {selected === 'stripe' && (
                <SectionCard
                    id="integrations"
                    icon={CreditCard}
                    title={m['admin.billing.integrations.stripe.title']()}
                    desc={m['admin.billing.integrations.stripe.desc']()}
                    right={
                        <MasterToggle
                            checked={stripeEnabled}
                            disabled={busy}
                            label={m['admin.billing.integrations.stripe.enable']()}
                            onChange={next => toggleIntegration.mutate({ id: 'stripe', value: next })}
                        />
                    }
                >
                    {/* The master switch moved to the header: it was the first row
                        of this group, indistinguishable from the two methods that
                        only work while it's on. */}
                    <Block label={m['admin.billing.integrations.extraMethods']()}>
                        <ToggleGroup>
                            <ToggleRow
                                label={m['admin.billing.integrations.paypalStripe.enable']()}
                                desc={m['admin.billing.integrations.paypalStripe.enableDesc']()}
                                checked={paypalViaStripe}
                                disabled={busy || !stripeEnabled}
                                onChange={next => toggleFlat.mutate({ key: 'paypal', value: next })}
                            />
                            <ToggleRow
                                label={m['admin.billing.integrations.link.enable']()}
                                desc={m['admin.billing.integrations.link.enableDesc']()}
                                checked={linkEnabled}
                                disabled={busy || !stripeEnabled}
                                onChange={next => toggleFlat.mutate({ key: 'link', value: next })}
                            />
                        </ToggleGroup>
                    </Block>

                    {/* Keys before webhook: that's the order the provider's own setup
                        runs in, and the webhook is useless without them. */}
                    <Block label={m['admin.billing.integrations.apiKeys']()}>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => setStripeOpen(true)}>
                                <KeyRound className="h-4 w-4" />
                                {stripeConfigured ? m['admin.billing.integrations.stripe.update']() : m['admin.billing.integrations.stripe.add']()}
                            </Button>
                            {stripeConfigured && (
                                <Button variant="ghost" size="sm" onClick={() => setDeleteKeysOpen(true)}>
                                    {m['admin.billing.integrations.stripe.delete']()}
                                </Button>
                            )}
                            <span className="text-xs text-[var(--color-ink-faint)]">{keysMeta(stripeConfigured)}</span>
                        </div>
                    </Block>

                    {webhookSetup?.stripe && (
                        <WebhookPanel
                            provider="Stripe"
                            url={webhookSetup.stripe.url}
                            events={webhookSetup.stripe.events}
                            description={m['admin.billing.integrations.webhook.stripeDescription']()}
                        />
                    )}
                </SectionCard>
            )}

            {/* PayPal — standalone, direct integration (not via Stripe) */}
            {selected === 'paypal' && (
                <SectionCard
                    icon={Wallet}
                    title={m['admin.billing.integrations.paypal.title']()}
                    desc={m['admin.billing.integrations.paypal.desc']()}
                    right={
                        <MasterToggle
                            checked={paypalStandaloneEnabled}
                            disabled={busy}
                            label={m['admin.billing.integrations.paypal.enable']()}
                            onChange={next => toggleIntegration.mutate({ id: 'paypal', value: next })}
                        />
                    }
                >
                    <Block label={m['admin.billing.integrations.apiKeys']()}>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => setPaypalOpen(true)}>
                                <KeyRound className="h-4 w-4" />
                                {paypalStandaloneConfigured ? m['admin.billing.integrations.paypal.update']() : m['admin.billing.integrations.paypal.add']()}
                            </Button>
                            <span className="text-xs text-[var(--color-ink-faint)]">
                                {keysMeta(paypalStandaloneConfigured)}
                            </span>
                        </div>
                    </Block>

                    {webhookSetup?.paypal && (
                        <WebhookPanel
                            provider="PayPal"
                            url={webhookSetup.paypal.url}
                            events={webhookSetup.paypal.events}
                            description={m['admin.billing.integrations.webhook.paypalDescription']()}
                            note={m['admin.billing.integrations.webhook.paypalNote']()}
                        />
                    )}
                </SectionCard>
            )}

            <StripeKeysModal open={stripeOpen} onClose={() => setStripeOpen(false)} />
            <PayPalKeysModal open={paypalOpen} onClose={() => setPaypalOpen(false)} initialMode={paypalMode} />

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
        </div>
    );
}
