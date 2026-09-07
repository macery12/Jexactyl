import { beforeEach, describe, expect, it, vi } from 'vitest';
import http from '@/lib/http';
import { clearCustomDomainToken, getCustomDomainSettings, updateCustomDomainSettings } from './adminCustomDomains';

vi.mock('@/lib/http', () => ({ default: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

describe('custom domain credential API', () => {
    beforeEach(() => vi.clearAllMocks());

    it('keeps only configured metadata even if an older server sends a token', async () => {
        vi.mocked(http.get).mockResolvedValue({ data: { data: { cloudflare_token_configured: true, cloudflare_token: 'legacy-secret' } } });
        const settings = await getCustomDomainSettings();
        expect(settings.cloudflareTokenConfigured).toBe(true);
        expect(settings).not.toHaveProperty('cloudflareToken');
        expect(JSON.stringify(settings)).not.toContain('legacy-secret');
    });

    it('leaves credentials out of ordinary settings saves', async () => {
        await updateCustomDomainSettings({ enabled: true });
        expect(http.put).toHaveBeenCalledWith('/api/application/custom-domains/settings', { enabled: true });
    });

    it('uses an explicit clear endpoint', async () => {
        await clearCustomDomainToken();
        expect(http.delete).toHaveBeenCalledWith('/api/application/custom-domains/settings/cloudflare-token');
    });
});
