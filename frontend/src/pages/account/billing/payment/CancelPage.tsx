import { m } from '@/i18n/messages';
import { Link, useSearchParams } from 'react-router-dom';
import { XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { clearAllDrafts } from '../order/draft';
import { useEffect } from 'react';
import { cancelPayPalOrder } from '@/api/accountBilling';

export default function CancelPage() {
    const [params] = useSearchParams();
    const paypalOrderId = params.get('token') ?? params.get('order_id');
    const planChangeServer = params.get('plan_change') === 'true' ? params.get('server') : null;

    useEffect(() => {
        clearAllDrafts();
        if (paypalOrderId) {
            // The endpoint is an owner-scoped pending->cancelled CAS, so a
            // duplicate StrictMode callback is harmless.
            void cancelPayPalOrder(paypalOrderId);
        }
    }, [paypalOrderId]);

    return (
        <div className="flex min-h-[60vh] items-center justify-center">
            <div className="w-full max-w-md rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 p-10 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-[var(--color-danger)]/15">
                    <XCircle className="h-7 w-7 text-[var(--color-danger)]" />
                </div>
                <h2 className="mt-5 text-xl font-semibold text-[var(--color-ink)]">{m['billing.cancel.title']()}</h2>
                <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{m['billing.cancel.body']()}</p>
                <div className="mt-6">
                    <Link to={planChangeServer ? `/server/${planChangeServer}/billing` : '/billing/order'}>
                        <Button>
                            {planChangeServer
                                ? m['server.billing.backToServerBilling']()
                                : m['billing.cancel.back']()}
                        </Button>
                    </Link>
                </div>
            </div>
        </div>
    );
}
