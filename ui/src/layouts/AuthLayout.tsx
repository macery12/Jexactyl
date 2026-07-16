import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { useFlags } from '@/state/flags';
import { FullPageSpinner } from '@/components/ui/Spinner';

// Centered card, no app chrome — used for the whole /auth/* tree.
export default function AuthLayout() {
    const site = useFlags(s => s.site);

    return (
        <div className="bg-aurora flex min-h-screen items-center justify-center px-4 py-12">
            <div className="w-full max-w-md">
                <div className="mb-8 flex items-center justify-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-[var(--brand)]" />
                    <span className="text-lg font-semibold tracking-tight">{site?.name ?? 'M12Labs'}</span>
                </div>
                <div className="rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/80 p-8 backdrop-blur">
                    <Suspense fallback={<FullPageSpinner />}>
                        <Outlet />
                    </Suspense>
                </div>
            </div>
        </div>
    );
}
