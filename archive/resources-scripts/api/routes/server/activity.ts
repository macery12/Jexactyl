import type { AxiosError } from 'axios';
import type { SWRConfiguration } from 'swr';
import useSWR from 'swr';

import type { PaginatedResult, QueryBuilderParams } from '@/api/http';
import http, { withQueryBuilderParams } from '@/api/http';
import { toPaginatedSet } from '@definitions/helpers';
import type { ActivityLog } from '@definitions/account';
import { Transformers } from '@definitions/account';
import useFilteredObject from '@/plugins/useFilteredObject';
import { useServerSWRKey } from '@/plugins/useSWRKey';
import { ServerContext } from '@/state/server';

export type ActivityLogFilters = QueryBuilderParams<'ip' | 'event' | 'search' | 'actor', 'timestamp'>;

const useActivityLogs = (
    filters?: ActivityLogFilters,
    config?: SWRConfiguration<PaginatedResult<ActivityLog>, AxiosError>,
) => {
    const uuid = ServerContext.useStoreState(state => state.server.data?.uuid);
    const key = useServerSWRKey(['activity', useFilteredObject(filters || {})]);

    return useSWR<PaginatedResult<ActivityLog>>(
        key,
        async () => {
            const { data } = await http.get(`/api/client/servers/${uuid}/activity`, {
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

const getActivityUsers = async (uuid: string): Promise<Array<{ uuid: string; username: string }>> => {
    const { data } = await http.get(`/api/client/servers/${uuid}/activity/users`);
    return data.data;
};

const getActivityEvents = async (uuid: string): Promise<string[]> => {
    const { data } = await http.get(`/api/client/servers/${uuid}/activity/events`);
    return data.data;
};

export { useActivityLogs, getActivityUsers, getActivityEvents };
