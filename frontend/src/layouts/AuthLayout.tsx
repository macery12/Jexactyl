import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { useFlags } from '@/state/flags';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { BrandMark } from '@/components/ui/BrandMark';

// Centered card, no app chrome — used for the whole /auth/* tree.
export default function AuthLayout() {
    const site = useFlags(s => s.site);

    return (
        <main className="bg-aurora flex min-h-screen items-center justify-center px-4 py-12">
            <div className="w-full max-w-md">
                <div className="mb-8 flex justify-center">
                    <BrandMark name={site?.name ?? 'M12Labs'} logo={site?.logo} size="lg" />
                </div>
                <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-8">
                    <Suspense fallback={<FullPageSpinner />}>
                        <Outlet />
                    </Suspense>
                </div>
            </div>
        </main>
    );
}
