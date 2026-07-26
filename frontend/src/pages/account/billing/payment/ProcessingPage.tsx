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
import { clearAllDrafts } from '../order/draft';

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
        clearAllDrafts();

        const stripeIntent = params.get('payment_intent');
        const token = params.get('token');
        const processor = params.get('processor');
        const renewal = params.get('renewal') === 'true';
        const renewedServer = params.get('server');
        let disposed = false;

        // Full reload, not navigate: the server record the cockpit holds is now
        // stale (new renewal date, and the server may have just come out of
        // suspension).
        const finish = () => {
            if (renewal && renewedServer) {
                window.location.href = abs(`/server/${renewedServer}/billing`);
            } else {
                navigate('/billing/success');
            }
        };

        if (stripeIntent) {
            void (async () => {
                for (let attempt = 0; attempt < 60 && !disposed; attempt += 1) {
                    try {
                        await processPaidOrder(stripeIntent, renewal);
                        if (!disposed) finish();
                        return;
                    } catch {
                        if (attempt < 59) {
                            await new Promise(resolve => window.setTimeout(resolve, 2000));
                        }
                    }
                }

                if (!disposed) {
                    // A timeout or lost response after capture is financially
                    // ambiguous. Keep the user on the recovery page instead of
                    // mislabelling the payment as cancelled.
                    push({ type: 'warning', message: m['billing.processing.verifyDelay']() });
                }
            })();

            return () => {
                disposed = true;
            };
        }

        const paypalActive = processor === 'paypal' || (billing.processors?.paypal?.available && !processor);
        if (token && paypalActive) {
            void (async () => {
                try {
                    const { order_id } = await getOrderIdFromToken(token);
                    for (let attempt = 0; attempt < 60 && !disposed; attempt += 1) {
                        try {
                            await capturePayPalOrder(order_id);
                        } catch {
                            // The provider may have completed capture even when
                            // our response was lost. The owner-scoped status
                            // endpoint is the durable source of truth.
                        }

                        try {
                            const status = await checkPayPalOrderStatus(order_id);
                            if (status.processed) {
                                finish();
                                return;
                            }
                            if (status.failed) {
                                navigate('/billing/cancel');
                                return;
                            }
                            if (status.requires_reconciliation) {
                                push({ type: 'warning', message: m['billing.processing.verifyDelay']() });
                                return;
                            }
                        } catch {
                            // Retry transient status failures below.
                        }

                        if (attempt < 59) {
                            await new Promise(resolve => window.setTimeout(resolve, 2000));
                        }
                    }

                    if (!disposed) {
                        push({ type: 'warning', message: m['billing.processing.verifyDelay']() });
                    }
                } catch {
                    if (disposed) return;
                    push({ type: 'error', message: m['billing.processing.paypalVerifyError']() });
                }
            })();

            return () => {
                disposed = true;
            };
        }

        push({ type: 'error', message: m['billing.processing.fulfillError']() });
        return () => {
            disposed = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="flex min-h-[60vh] items-center justify-center">
            <div className="w-full max-w-md rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 p-10 text-center">
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
