import type { AxiosError } from 'axios';
import type { SWRConfiguration } from 'swr';
import useSWR from 'swr';

import http, { PaginatedResult, QueryBuilderParams, withQueryBuilderParams } from '@/api/http';
import { toPaginatedSet } from '@definitions/helpers';
import { ActivityLog, Transformers } from '@definitions/account';
import useFilteredObject from '@/plugins/useFilteredObject';
import { useUserSWRKey } from '@/plugins/useSWRKey';

export type ActivityLogFilters = QueryBuilderParams<'ip' | 'event' | 'search' | 'actor', 'timestamp'>;

const useActivityLogs = (
    filters?: ActivityLogFilters,
    config?: SWRConfiguration<PaginatedResult<ActivityLog>, AxiosError>,
) => {
    const key = useUserSWRKey(['admin', 'activity', JSON.stringify(useFilteredObject(filters || {}))]);

    return useSWR<PaginatedResult<ActivityLog>>(
        key,
        async () => {
            const { data } = await http.get('/api/application/activity', {
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

const getActivityUsers = async (): Promise<Array<{ uuid: string; username: string }>> => {
    const { data } = await http.get('/api/application/activity/users');
    return data.data;
};

const getActivityEvents = async (): Promise<string[]> => {
    const { data } = await http.get('/api/application/activity/events');
    return data.data;
};

export { useActivityLogs, getActivityUsers, getActivityEvents };
