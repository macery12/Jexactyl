import { m } from '@/i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { getBillingProfile, hasCompleteBillingProfile } from '@/api/accountBilling';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { SettingsCard } from './SettingsCard';
import { BillingAddressModal } from './BillingAddressModal';

export function BillingAddressCard() {
    const [editing, setEditing] = useState(false);

    const { data: profile, isLoading } = useQuery({
        queryKey: ['account', 'billing-profile'],
        queryFn: getBillingProfile,
    });

    const complete = hasCompleteBillingProfile(profile ?? null);
    // A profile row exists (drives POST-vs-PUT) as soon as any field came back.
    const exists = profile != null;

    const editButton = (
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            {complete ? m['account.billing.edit']() : m['account.billing.add']()}
        </Button>
    );

    return (
        <SettingsCard
            title={m['account.billing.title']()}
            description={m['account.billing.description']()}
            icon={MapPin}
            right={!isLoading ? editButton : undefined}
        >
            {isLoading ? (
                <div className="flex justify-center py-2">
                    <Spinner className="h-5 w-5" />
                </div>
            ) : complete && profile ? (
                <address className="text-sm not-italic leading-relaxed text-[var(--color-ink)]">
                    <div className="font-medium">
                        {profile.first_name} {profile.last_name}
                    </div>
                    <div className="text-[var(--color-ink-muted)]">
                        {profile.address_line1}
                        {profile.address_line2 && <>, {profile.address_line2}</>}
                    </div>
                    <div className="text-[var(--color-ink-muted)]">
                        {profile.city}, {profile.state} {profile.postal_code}
                    </div>
                    <div className="text-[var(--color-ink-muted)]">{profile.country}</div>
                    {profile.phone && <div className="mt-1 text-[var(--color-ink-muted)]">{profile.phone}</div>}
                </address>
            ) : (
                <p className="text-sm text-[var(--color-ink-muted)]">{m['account.billing.empty']()}</p>
            )}

            {editing && (
                <BillingAddressModal
                    open
                    onClose={() => setEditing(false)}
                    profile={profile ?? null}
                    exists={exists}
                />
            )}
        </SettingsCard>
    );
}
