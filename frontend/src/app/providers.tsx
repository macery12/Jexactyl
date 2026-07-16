import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query';
import { FlashHost } from '@/components/shell/FlashHost';

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <QueryClientProvider client={queryClient}>
            {children}
            <FlashHost />
        </QueryClientProvider>
    );
}
