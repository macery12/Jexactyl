import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderRulesResponse } from '@/api/routes/admin/marketplace/providers';
import * as providerApi from '@/api/routes/admin/marketplace/providers';
import { saveAllProviders } from './AccessControlContainer';

const sampleRules: ProviderRulesResponse = {
    nests: [
        {
            id: 1,
            name: 'Nest One',
            eggs: [{ id: 10, name: 'Egg One', nest_id: 1 }],
        },
    ],
    rules: {
        'modrinth.mods': {
            provider_key: 'modrinth.mods',
            enabled_global: true,
            allowed_nest_ids: [],
            allowed_egg_ids: [],
        },
        'modrinth.plugins': {
            provider_key: 'modrinth.plugins',
            enabled_global: true,
            allowed_nest_ids: [],
            allowed_egg_ids: [],
        },
        'spigot.plugins': {
            provider_key: 'spigot.plugins',
            enabled_global: true,
            allowed_nest_ids: [],
            allowed_egg_ids: [],
        },
    },
};

describe('saveAllProviders', () => {
    const mockGetProviderRules = vi.spyOn(providerApi, 'getProviderRules');
    const mockUpdateProviderRules = vi.spyOn(providerApi, 'updateProviderRules');

    beforeEach(() => {
        mockGetProviderRules.mockResolvedValue(sampleRules);
        mockUpdateProviderRules.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('updates every provider and returns refreshed rules', async () => {
        const result = await saveAllProviders(sampleRules);

        expect(mockUpdateProviderRules).toHaveBeenCalledTimes(3);
        expect(mockUpdateProviderRules).toHaveBeenCalledWith(
            expect.objectContaining({ provider_key: 'modrinth.mods', enabled_global: true }),
        );
        expect(mockGetProviderRules).toHaveBeenCalledTimes(1);
        expect(result.rules['modrinth.mods']!.enabled_global).toBe(true);
    });

    it('propagates errors when a provider update fails', async () => {
        mockUpdateProviderRules.mockRejectedValue(new Error('failed'));

        await expect(saveAllProviders(sampleRules)).rejects.toThrow('failed');
        expect(mockGetProviderRules).not.toHaveBeenCalled();
    });
});
