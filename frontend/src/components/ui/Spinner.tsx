import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Spinner({ className }: { className?: string }) {
    return <Loader2 className={cn('animate-spin text-[var(--brand)]', className)} />;
}

export function FullPageSpinner() {
    return (
        <div className="flex h-full w-full items-center justify-center py-24">
            <Spinner className="h-8 w-8" />
        </div>
    );
}
