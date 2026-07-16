import { type BillingProfile } from '@/api/routes/account/billing/billingProfile';
import BillingProfileForm from '@account/billing/BillingProfileForm';
import { Dialog } from '@/elements/dialog';
import asDialog from '@/hoc/asDialog';

interface Props {
    existing: BillingProfile | null;
    onSaved: (profile: BillingProfile) => void;
}

const BillingAddressModalContent = ({ existing, onSaved }: Props) => (
    <>
        <p className={'mb-4 text-sm text-neutral-400'}>
            Your billing information is stored encrypted and is used on your invoices. It is never shared with third
            parties.
        </p>
        <BillingProfileForm existing={existing} onSaved={onSaved} />
    </>
);

export default asDialog({ title: 'Billing Information', size: 'md' })(BillingAddressModalContent);
