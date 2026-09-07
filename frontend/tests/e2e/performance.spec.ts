import { expect, test, type Request, type Response } from '@playwright/test';

type RouteBudget = {
    name: string;
    path: string;
    maxBuildRequests: number;
    maxScriptRequests: number;
};

const routeBudgets: RouteBudget[] = [
    { name: 'landing', path: '/', maxBuildRequests: 40, maxScriptRequests: 30 },
    { name: 'login', path: '/auth/login', maxBuildRequests: 50, maxScriptRequests: 40 },
];

function isBuildAsset(request: Request) {
    return new URL(request.url()).pathname.startsWith('/build/');
}

test.describe('public route request budgets', () => {
    for (const budget of routeBudgets) {
        test(`${budget.name} stays within its initial request budget`, async ({ page }) => {
            const buildResponses: Response[] = [];
            const apiRequests: Request[] = [];

            page.on('response', response => {
                if (isBuildAsset(response.request())) buildResponses.push(response);
            });
            page.on('request', request => {
                if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request);
            });

            await page.goto(budget.path, { waitUntil: 'networkidle' });
            await expect(page.getByRole('main')).toBeVisible();

            const failedAssets = buildResponses
                .filter(response => !response.ok())
                .map(response => `${response.status()} ${new URL(response.url()).pathname}`);
            const assetPaths = buildResponses.map(response => new URL(response.url()).pathname);
            const scriptCount = buildResponses.filter(response => response.request().resourceType() === 'script').length;

            expect(failedAssets).toEqual([]);
            expect(new Set(assetPaths).size, 'build assets should not be requested more than once').toBe(assetPaths.length);
            expect(buildResponses.length).toBeLessThanOrEqual(budget.maxBuildRequests);
            expect(scriptCount).toBeLessThanOrEqual(budget.maxScriptRequests);
            expect(apiRequests.map(request => new URL(request.url()).pathname)).toEqual([]);
        });
    }
});

test.describe('authenticated loading stability', () => {
    test('server shell remains stable while server data loads', async ({ page }) => {
        test.setTimeout(20_000);
        const client = await page.context().newCDPSession(page);
        await client.send('Network.enable');
        await client.send('Network.emulateNetworkConditions', {
            offline: false,
            latency: 150,
            downloadThroughput: 200_000,
            uploadThroughput: 100_000,
        });
        await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });

        await page.addInitScript(() => {
            const metrics = window as typeof window & { __cumulativeLayoutShift?: number };
            metrics.__cumulativeLayoutShift = 0;

            new PerformanceObserver(list => {
                for (const entry of list.getEntries()) {
                    const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
                    if (!shift.hadRecentInput) metrics.__cumulativeLayoutShift! += shift.value;
                }
            }).observe({ type: 'layout-shift', buffered: true });
        });

        await page.route('**/api/client/servers/fixture', async route => {
            await new Promise(resolve => setTimeout(resolve, 750));
            await route.continue();
        });

        await page.goto('/server/fixture/activity?__lighthouse_auth=1');
        await expect(page.getByRole('heading', { level: 1, name: 'Lighthouse Fixture Server' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
        await page.waitForTimeout(100);

        const cumulativeLayoutShift = await page.evaluate(
            () => (window as typeof window & { __cumulativeLayoutShift?: number }).__cumulativeLayoutShift ?? 0,
        );
        expect(cumulativeLayoutShift).toBeLessThan(0.02);
    });
});
