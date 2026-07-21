import AdminBox from '@/elements/AdminBox';
import ToggleFeatureButton from './ToggleFeatureButton';
import { faDollar, faExchange, faGavel, faPowerOff, faShieldHalved } from '@fortawesome/free-solid-svg-icons';
import { useStoreActions, useStoreState } from '@/state/hooks';
import Label from '@/elements/Label';
import Select from '@/elements/Select';
import currencyDictionary from '@/assets/currency';
import ExportConfigButton from './config/ExportConfigButton';
import FlashMessageRender from '@/elements/FlashMessageRender';
import ImportConfigButton from './config/ImportConfigButton';
import { updateSettings } from '@/api/routes/admin/billing';
import { updateInvoiceSettings } from '@/api/routes/admin/billing/invoices';
import BillingLinksForm from '@admin/modules/billing/BillingLinksForm';
import Switch from '@/elements/Switch';

export type BillingSetupDialog = 'paypal' | 'link' | 'setup' | 'payment' | 'none';

export default () => {
    const settings = useStoreState(s => s.everest.data!.billing);
    const updateEverest = useStoreActions(s => s.everest.updateEverest);

    const submit = async (key: string, value: boolean | string) => {
        await updateSettings(key, value).then(() => {
            updateEverest({ billing: { ...settings, [key]: value } });
        });
    };

    const handleCurrencyChange = async (event: any) => {
        const code: string = event.target.value.toUpperCase();
        const symbol: string = currencyDictionary[code]!.symbol;

        // Save both fields to DB, then update the nested currency object in local
        // state so the new symbol shows immediately without a page reload.
        await updateSettings('currency:code', code);
        await updateSettings('currency:symbol', symbol);
        updateEverest({ billing: { ...settings, currency: { code: code.toLowerCase(), symbol } } });
    };

    const handleCustomerRequirementChange = async (checked: boolean) => {
        await updateInvoiceSettings({ require_billing_address: checked });
        updateEverest({ billing: { ...settings, require_billing_address: checked } });
    };

    return (
        <div className={'grid gap-4 lg:grid-cols-3'}>
            <AdminBox title={'Primary Currency'} icon={faDollar}>
                Choose a primary currency to charge users.
                <div className={'mt-4'}>
                    <Label>Currency Code / Name</Label>
                    <Select onChange={handleCurrencyChange}>
                        {Object.keys(currencyDictionary).map(code => (
                            <option
                                key={code}
                                value={code}
                                onChange={() => console.log('hello')}
                                selected={code === settings.currency.code.toUpperCase()}
                            >
                                {code} - {currencyDictionary[code]!.name}
                            </option>
                        ))}
                    </Select>
                </div>
            </AdminBox>
            <AdminBox title={'Import/Export Configuration'} icon={faExchange}>
                <FlashMessageRender byKey={'billing:config'} className={'mb-2'} />
                Use the below options to either export your current billing configurations, or use the Import button to
                import a pre-created set of categories and products to M12Labs.
                <div className={'mt-3 text-right'}>
                    <ExportConfigButton />
                    <ImportConfigButton />
                </div>
            </AdminBox>
            <AdminBox title={'Legal Document Links'} icon={faGavel}>
                Provide a link to your business&apos; ToS or privacy policy that users must accept before purchase.
                <BillingLinksForm />
            </AdminBox>
            <AdminBox title={'Plan Change Cooldown'} icon={faExchange}>
                Configure how often users can change between plans to prevent abuse. Default is 72 hours (3 days).
                <div className={'mt-4'}>
                    <Label>Cooldown Period (hours)</Label>
                    <input
                        type="number"
                        min="0"
                        max="720"
                        className="w-full rounded border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-gray-300 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={settings.plan_change_cooldown_hours ?? 72}
                        onChange={e => submit('plan_change_cooldown_hours', String(parseInt(e.target.value)))}
                    />
                    <p className={'mt-2 text-xs text-gray-400'}>
                        Users can only change plans once per cooldown period. Set to 0 to disable cooldown (not
                        recommended).
                    </p>
                </div>
            </AdminBox>
            <AdminBox title={'Customer Requirements'} icon={faShieldHalved}>
                Configure checkout requirements for customers before they can complete a purchase.
                <div className={'mt-4'}>
                    <Switch
                        name={'require_billing_address'}
                        label={'Require billing address to checkout'}
                        description={
                            'When enabled, customers must add a billing address in their account settings before they can complete a purchase. The address is included on invoices.'
                        }
                        defaultChecked={settings.require_billing_address ?? false}
                        onChange={e => handleCustomerRequirementChange(e.target.checked)}
                    />
                </div>
            </AdminBox>
            <AdminBox title={'Disable Billing Module'} icon={faPowerOff}>
                Clicking the button below will disable all modules of the billing system - such as subscriptions, server
                purchasing and more. Make sure that this will not impact your users before disabling.
                <div className={'mt-3 text-right'}>
                    <ToggleFeatureButton />
                </div>
            </AdminBox>
        </div>
    );
};
