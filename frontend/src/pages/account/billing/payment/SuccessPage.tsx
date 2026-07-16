import { m } from '@/i18n';
import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export default function SuccessPage() {
    return (
        <div className="flex min-h-[60vh] items-center justify-center">
            <div className="w-full max-w-md rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 p-10 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-accent)]/15">
                    <CheckCircle2 className="h-7 w-7 text-[var(--color-accent)]" />
                </div>
                <h2 className="mt-5 text-xl font-semibold text-[var(--color-ink)]">{m['billing.success.title']()}</h2>
                <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{m['billing.success.body']()}</p>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                    <Link to="/">
                        <Button className="w-full sm:w-auto">{m['billing.success.dashboard']()}</Button>
                    </Link>
                    <Link to="/billing/orders">
                        <Button variant="outline" className="w-full sm:w-auto">{m['billing.success.orders']()}</Button>
                    </Link>
                </div>
            </div>
        </div>
    );
}
