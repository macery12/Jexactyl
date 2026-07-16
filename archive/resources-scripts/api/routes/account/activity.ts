import type { AxiosError } from 'axios';
import type { SWRConfiguration } from 'swr';
import useSWR from 'swr';
import http, { PaginatedResult, QueryBuilderParams, withQueryBuilderParams } from '@/api/http';
import { toPaginatedSet } from '@definitions/helpers';
import { ActivityLog, Transformers } from '@definitions/account';
import useFilteredObject from '@/plugins/useFilteredObject';
import { useUserSWRKey } from '@/plugins/useSWRKey';

export type ActivityLogFilters = QueryBuilderParams<'ip' | 'event' | 'scope' | 'server', 'timestamp'>;

export interface OwnedServer {
    uuid: string;
    name: string;
}

const useActivityLogs = (
    filters?: ActivityLogFilters,
    config?: SWRConfiguration<PaginatedResult<ActivityLog>, AxiosError>,
) => {
    const key = useUserSWRKey(['account', 'activity', JSON.stringify(useFilteredObject(filters || {}))]);

    return useSWR<PaginatedResult<ActivityLog>>(
        key,
        async () => {
            const { data } = await http.get('/api/client/account/activity', {
                params: {
                    ...withQueryBuilderParams(filters),
                    include: ['actor'],
                },
            });

            return toPaginatedSet(data, Transformers.toActivityLog);
        },
        { revalidateOnMount: false, ...(config || {}) },
    );
};

const useOwnedServers = (config?: SWRConfiguration<OwnedServer[], AxiosError>) => {
    const key = useUserSWRKey(['account', 'owned-servers']);

    return useSWR<OwnedServer[]>(
        key,
        async () => {
            const { data } = await http.get('/api/client/account/owned-servers');
            return (data.data as OwnedServer[]) ?? [];
        },
        { revalidateOnMount: true, revalidateOnFocus: false, ...(config || {}) },
    );
};

export { useActivityLogs, useOwnedServers };
