import { describe, expect, it } from 'vitest';
import { rulesAreEqual } from './AccessControlContainer';
import { ProviderRule } from '@/api/routes/admin/marketplace/providers';

describe('rulesAreEqual', () => {
    const base: ProviderRule = {
        provider_key: 'modrinth.mods',
        enabled_global: true,
        allowed_nest_ids: [1, 2, 3],
        allowed_egg_ids: [5, 6],
    };

    it('considers rules equal when ids match regardless of order', () => {
        const reordered: ProviderRule = {
            provider_key: 'modrinth.mods',
            enabled_global: true,
            allowed_nest_ids: [3, 2, 1],
            allowed_egg_ids: [6, 5],
        };

        expect(rulesAreEqual(base, reordered, 'modrinth.mods')).toBe(true);
    });

    it('detects changes in enabled flag or ids', () => {
        const disabled: ProviderRule = {
            ...base,
            enabled_global: false,
        };

        const extraEgg: ProviderRule = {
            ...base,
            allowed_egg_ids: [...(base.allowed_egg_ids ?? []), 10],
        };

        expect(rulesAreEqual(base, disabled, 'modrinth.mods')).toBe(false);
        expect(rulesAreEqual(base, extraEgg, 'modrinth.mods')).toBe(false);
    });
});
