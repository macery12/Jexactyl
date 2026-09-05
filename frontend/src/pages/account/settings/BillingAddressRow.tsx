import { m } from '@/i18n/messages';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { getBillingProfile, hasCompleteBillingProfile } from '@/api/accountBilling';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { SettingsRow } from './SettingsRow';
import { BillingAddressModal } from './BillingAddressModal';

// Billing address as a slim row: the description line doubles as a one-line
// address summary once one is on file; the full address lives in the modal.
export function BillingAddressRow() {
    const [editing, setEditing] = useState(false);

    const { data: profile, isLoading } = useQuery({
        queryKey: ['account', 'billing-profile'],
        queryFn: getBillingProfile,
    });

    const complete = hasCompleteBillingProfile(profile ?? null);
    // A profile row exists (drives POST-vs-PUT) as soon as any field came back.
    const exists = profile != null;

    const summary =
        complete && profile
            ? `${profile.first_name} ${profile.last_name} · ${profile.address_line1}, ${profile.city}, ${profile.country}`
            : m['account.billing.description']();

    return (
        <SettingsRow
            icon={MapPin}
            title={m['account.billing.title']()}
            description={summary}
            action={
                isLoading ? (
                    <Spinner className="h-4 w-4" />
                ) : (
                    <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                        {complete ? m['account.billing.edit']() : m['account.billing.add']()}
                    </Button>
                )
            }
        >
            {editing && (
                <BillingAddressModal
                    open
                    onClose={() => setEditing(false)}
                    profile={profile ?? null}
                    exists={exists}
                />
            )}
        </SettingsRow>
    );
}
