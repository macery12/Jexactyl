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
