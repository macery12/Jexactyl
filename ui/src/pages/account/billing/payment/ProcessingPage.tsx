import { m } from '@/i18n';
import { abs } from '@/lib/base';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { useBilling } from '@/state/billing';
import {
    processPaidOrder,
    capturePayPalOrder,
    checkPayPalOrderStatus,
    getOrderIdFromToken,
} from '@/api/accountBilling';

// Terminal payment handler. Stripe returns here with ?payment_intent=…; PayPal
// with ?token=…&processor=paypal. We finalise the order, then route to the
// success or cancel page. Ported from V1's summary/Processing.
//
// A server renewal comes back with ?renewal=true&server=<identifier> and lands
// on that server's billing page instead of the new-server success page — there
// is no server being provisioned to celebrate.
export default function ProcessingPage() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const push = useFlashes(s => s.push);
    const { billing } = useBilling();
    const [session] = useState(() => params.get('payment_intent') ?? params.get('token') ?? 'Unknown');
    const ran = useRef(false);

    useEffect(() => {
        if (ran.current) return;
        ran.current = true;

        const stripeIntent = params.get('payment_intent');
        const token = params.get('token');
        const processor = params.get('processor');
        const renewal = params.get('renewal') === 'true';
        const renewedServer = params.get('server');

        // Full reload, not navigate: the server record the cockpit holds is now
        // stale (new renewal date, and the server may have just come out of
        // suspension).
        const finish = () => {
            if (renewal && renewedServer) {
                window.location.href = abs(`/server/${renewedServer}/billing`);
            } else {
                navigate('/account/billing/success');
            }
        };

        if (stripeIntent) {
            processPaidOrder(stripeIntent, renewal)
                .then(finish)
                .catch(() => navigate('/account/billing/cancel'));
            return;
        }

        const paypalActive = processor === 'paypal' || (billing.processors?.paypal?.available && !processor);
        if (token && paypalActive) {
            getOrderIdFromToken(token)
                .then(({ order_id }) =>
                    capturePayPalOrder(order_id).then(() => {
                        let polls = 0;
                        const poll = async () => {
                            polls += 1;
                            if (polls > 60) {
                                push({ type: 'warning', message: m['billing.processing.verifyDelay']() });
                                return;
                            }
                            const status = await checkPayPalOrderStatus(order_id);
                            if (status.processed) finish();
                            else if (status.failed) navigate('/account/billing/cancel');
                            else setTimeout(poll, 2000);
                        };
                        return poll();
                    }),
                )
                .catch(() => {
                    push({ type: 'error', message: m['billing.processing.paypalVerifyError']() });
                    navigate('/account/billing/cancel');
                });
            return;
        }

        push({ type: 'error', message: m['billing.processing.fulfillError']() });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="flex min-h-[60vh] items-center justify-center">
            <div className="w-full max-w-md rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 p-10 text-center">
                <Spinner className="mx-auto h-9 w-9" />
                <h2 className="mt-5 text-xl font-semibold text-[var(--color-ink)]">{m['billing.processing.title']()}</h2>
                <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{m['billing.processing.body']()}</p>
                <p className="mt-6 text-[11px] text-[var(--color-ink-faint)]">
                    {m['billing.processing.session']({ id: session })}
                </p>
            </div>
        </div>
    );
}
