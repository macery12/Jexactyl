import { Order, Transformers } from '@definitions/admin';
import { OrderFilters } from './types';
import { createPaginatedHook, createContext } from '@/api';
import http from '@/api/http';

export const Context = createContext<OrderFilters>();

export const useGetOrders = createPaginatedHook<Order, OrderFilters>({
    url: '/api/application/billing/orders',
    swrKey: 'orders',
    context: Context,
    transformer: Transformers.toOrder,
});

export interface ThreatSignal {
    category: string;
    description: string;
    points: number;
    max_points: number;
    fired: boolean;
}

export interface ThreatBreakdown {
    score: number;
    signals: ThreatSignal[];
}

export const getOrderThreat = (orderId: number): Promise<ThreatBreakdown> => {
    return http.get(`/api/application/billing/orders/${orderId}/threat`).then(({ data }) => data as ThreatBreakdown);
};
