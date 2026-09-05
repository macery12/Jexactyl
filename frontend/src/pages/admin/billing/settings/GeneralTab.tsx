import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Coins, Gavel } from 'lucide-react';
import { m } from '@/i18n/messages';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { useBilling } from '@/state/billing';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import currencyDictionary from '@/assets/currency';
import { updateBillingSetting } from '@/api/adminBillingSettings';
import { updateInvoiceSettings } from '@/api/adminBillingInvoices';
import { SectionCard, FieldGrid, FieldRow, ToggleGroup, ToggleRow } from '@/components/ui/editorChrome';
import { patchBilling } from './patchBilling';

// Tab 1 — what a customer sees or is bound by at checkout: the currency prices
// are quoted in, how often they may switch plans, and the legal links they have
// to accept. Config import/export moved to the Advanced tab.
//
// Cards run full width and pair their fields off inside a FieldGrid. Two
// half-width cards side by side left each field about 190px, which was too
// narrow for a currency name or a URL to render without wrapping.
export default function GeneralTab() {
    const { push } = useFlashes();
    const { billing } = useBilling();
    const raw = billing as Record<string, any>;

    const currencyOptions = Object.keys(currencyDictionary).map(code => ({
        value: code,
        label: `${code} — ${currencyDictionary[code]!.name}`,
    }));

    const savedCode = (billing.currency?.code ?? 'USD').toUpperCase();
    const savedCooldown = Number(raw.plan_change_cooldown_hours ?? 72);

    const [currency, setCurrency] = useState(savedCode);
    const [cooldown, setCooldown] = useState(String(savedCooldown));
    const [terms, setTerms] = useState(billing.links?.terms ?? '');
    const [privacy, setPrivacy] = useState(billing.links?.privacy ?? '');
    const [requireAddress, setRequireAddress] = useState(Boolean(billing.require_billing_address));

    // One Save for the card rather than a button wedged beside the cooldown
    // input and a currency select that wrote on every keystroke of the dropdown.
    const saveGeneral = useMutation({
        mutationFn: async () => {
            const symbol = currencyDictionary[currency]?.symbol ?? '$';
            const hours = parseInt(cooldown, 10) || 0;
            if (currency !== savedCode) {
                await updateBillingSetting('currency:code', currency);
                await updateBillingSetting('currency:symbol', symbol);
            }
            if (hours !== savedCooldown) {
                await updateBillingSetting('plan_change_cooldown_hours', String(hours));
            }
            return { symbol, hours };
        },
        onSuccess: ({ symbol, hours }) => {
            patchBilling({
                currency: { code: currency.toLowerCase(), symbol },
                plan_change_cooldown_hours: hours,
            });
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

    const generalDirty = currency !== savedCode || (parseInt(cooldown, 10) || 0) !== savedCooldown;
    const linksDirty = terms !== (billing.links?.terms ?? '') || privacy !== (billing.links?.privacy ?? '');

    return (
        <div className="flex flex-col gap-6">
            <SectionCard
                id="general"
                icon={Coins}
                title={m['admin.billing.settings.general.title']()}
                desc={m['admin.billing.settings.general.desc']()}
                right={
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={!generalDirty || saveGeneral.isPending}
                        onClick={() => saveGeneral.mutate()}
                    >
                        {saveGeneral.isPending ? <Spinner className="h-4 w-4" /> : null}
                        {m['common.actions.save']()}
                    </Button>
                }
            >
                <FieldGrid>
                    <FieldRow
                        label={m['admin.billing.settings.currency.label']()}
                        desc={m['admin.billing.settings.currency.desc']()}
                    >
                        <Select value={currency} onChange={setCurrency} options={currencyOptions} />
                    </FieldRow>
                    <FieldRow
                        label={m['admin.billing.settings.cooldown.label']()}
                        desc={m['admin.billing.settings.cooldown.hint']()}
                    >
                        <Input
                            type="number"
                            min={0}
                            max={720}
                            value={cooldown}
                            onChange={e => setCooldown(e.target.value)}
                        />
                    </FieldRow>
                </FieldGrid>
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
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={!linksDirty || saveLinks.isPending}
                        onClick={() => saveLinks.mutate()}
                    >
                        {saveLinks.isPending ? <Spinner className="h-4 w-4" /> : null}
                        {m['common.actions.save']()}
                    </Button>
                }
            >
                <FieldGrid>
                    <FieldRow label={m['admin.billing.settings.legal.terms']()}>
                        <Input value={terms} onChange={e => setTerms(e.target.value)} placeholder="https://…/terms" />
                    </FieldRow>
                    <FieldRow label={m['admin.billing.settings.legal.privacy']()}>
                        <Input value={privacy} onChange={e => setPrivacy(e.target.value)} placeholder="https://…/privacy" />
                    </FieldRow>
                </FieldGrid>
            </SectionCard>
        </div>
    );
}
