import { m } from '@/i18n';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getServerView } from '@/api/adminServers';
import { ServerContext } from './ServerContext';
import { ServerHeader } from './ServerHeader';
import { ServerEditor } from './ServerEditor';
import { Spinner } from '@/components/ui/Spinner';

export default function ServerDetailPage() {
    const { id } = useParams();

    const { data: server, isLoading, isError } = useQuery({
        queryKey: ['admin', 'server-view', id],
        queryFn: () => getServerView(id!),
        enabled: !!id,
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Spinner className="h-7 w-7" />
            </div>
        );
    }

    if (isError || !server) {
        return (
            <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-5 py-4 text-sm text-[var(--color-danger)]">
                {m['admin.infrastructure.serverDetail.loadError']()}
            </div>
        );
    }

    return (
        <ServerContext.Provider value={server}>
            <div className="flex flex-col gap-5">
                <ServerHeader />
                <ServerEditor />
            </div>
        </ServerContext.Provider>
    );
}
