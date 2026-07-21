import { afterEach, describe, expect, it, vi } from 'vitest';
import http from '@/api/http';
import { getStripeIntent } from './stripe';

describe('getStripeIntent', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('sends the selected billing days when creating a Stripe intent', async () => {
        const post = vi.spyOn(http, 'post').mockResolvedValue({
            data: {
                id: 'pi_test_123',
                secret: 'secret_test_123',
            },
        });

        await getStripeIntent(42, 7, 10);

        expect(http.post).toHaveBeenCalledWith('/api/client/billing/products/42/intent', {
            coupon_id: 7,
            billing_days: 10,
        });

        post.mockRestore();
    });
});
