import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { selectedBaselineRoutes } = require('../lighthouse.config.cjs') as {
    selectedBaselineRoutes: (environment?: Record<string, string | undefined>) => Array<{
        area: string;
        name: string;
        path: string;
        url: string;
    }>;
};

describe('Lighthouse route selection', () => {
    it('keeps full and area audit modes', () => {
        expect(selectedBaselineRoutes({})).toHaveLength(115);
        expect(selectedBaselineRoutes({ LIGHTHOUSE_AREA: 'server' })).toHaveLength(21);
    });

    it('selects exact changed routes in the requested order', () => {
        const selected = selectedBaselineRoutes({
            LIGHTHOUSE_ROUTES: '/server/fixture/marketplace,/server/fixture/files,/server/fixture/files/new',
        });

        expect(selected.map(route => route.name)).toEqual(['Marketplace', 'Files', 'New file']);
    });

    it('deduplicates repeated selectors', () => {
        const selected = selectedBaselineRoutes({
            LIGHTHOUSE_ROUTES: '/settings,account:/settings',
        });

        expect(selected.map(route => route.name)).toEqual(['Account settings']);
    });

    it('requires area:path for an ambiguous path', () => {
        expect(() => selectedBaselineRoutes({ LIGHTHOUSE_ROUTES: '/' })).toThrow(
            'Ambiguous LIGHTHOUSE_ROUTES selector: /. Use one of: public:/, account:/',
        );
        expect(selectedBaselineRoutes({ LIGHTHOUSE_ROUTES: 'public:/' })[0]?.name).toBe('Landing');
    });

    it('rejects conflicting or unknown filters', () => {
        expect(() =>
            selectedBaselineRoutes({
                LIGHTHOUSE_AREA: 'server',
                LIGHTHOUSE_ROUTES: '/server/fixture/files',
            }),
        ).toThrow('Use either LIGHTHOUSE_AREA or LIGHTHOUSE_ROUTES, not both.');
        expect(() => selectedBaselineRoutes({ LIGHTHOUSE_ROUTES: '/missing' })).toThrow(
            'Unknown LIGHTHOUSE_ROUTES selector: /missing',
        );
    });
});
