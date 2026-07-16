import { AxiosError } from 'axios';
import useSWR, { SWRResponse } from 'swr';
import { useParams } from 'react-router-dom';
import http from '@/api/http';
import { Coupon, Transformers } from '@definitions/admin';
import { CouponFilters, CouponValues } from './types';
import { createPaginatedHook, createContext } from '@/api';

export const Context = createContext<CouponFilters>();

export const useGetCoupons = createPaginatedHook<Coupon, CouponFilters>({
    url: '/api/application/billing/coupons',
    swrKey: 'coupons',
    context: Context,
    transformer: Transformers.toCoupon,
});

export const getCoupons = (): Promise<Coupon[]> => {
    return new Promise((resolve, reject) => {
        http.get(`/api/application/billing/coupons`)
            .then(({ data }) => resolve((data.data || []).map(Transformers.toCoupon)))
            .catch(reject);
    });
};

export const getCoupon = async (id: number): Promise<Coupon> => {
    const { data } = await http.get(`/api/application/billing/coupons/${id}`);
    return Transformers.toCoupon(data);
};

export const createCoupon = (values: CouponValues): Promise<Coupon> => {
    return new Promise((resolve, reject) => {
        http.post(`/api/application/billing/coupons`, {
            code: values.code,
            type: values.type,
            value: values.value,
            max_uses: values.maxUses,
            max_uses_per_user: values.maxUsesPerUser,
            min_order_total: values.minOrderTotal,
            expires_at: values.expiresAt,
            is_active: values.isActive,
            allowed_for: values.allowedFor,
        })
            .then(({ data }) => resolve(Transformers.toCoupon(data)))
            .catch(reject);
    });
};

export const updateCoupon = (id: number, values: Partial<CouponValues>): Promise<void> => {
    return new Promise((resolve, reject) => {
        http.patch(`/api/application/billing/coupons/${id}`, {
            code: values.code,
            type: values.type,
            value: values.value,
            max_uses: values.maxUses,
            max_uses_per_user: values.maxUsesPerUser,
            min_order_total: values.minOrderTotal,
            expires_at: values.expiresAt,
            is_active: values.isActive,
            allowed_for: values.allowedFor,
        })
            .then(() => resolve())
            .catch(reject);
    });
};

export const deleteCoupon = (id: number): Promise<void> => {
    return new Promise((resolve, reject) => {
        http.delete(`/api/application/billing/coupons/${id}`)
            .then(() => resolve())
            .catch(reject);
    });
};

/**
 * Returns an SWR instance by automatically loading in the coupon for the currently
 * loaded route match in the admin area.
 */
export const useCouponFromRoute = (): SWRResponse<Coupon, AxiosError> => {
    const params = useParams<'id'>();

    return useSWR(`/api/application/billing/coupons/${params.id}`, async () => getCoupon(Number(params.id)));
};
