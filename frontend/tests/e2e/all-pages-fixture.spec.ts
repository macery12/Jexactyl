import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { routes } = require('../../lighthouse.routes.cjs') as {
    routes: Array<{ area: string; name: string; url: string }>;
};

for (const route of routes) {
    test(`${route.area}: ${route.name} boots from the production fixture`, async ({ page }) => {
        await page.goto(route.url);
        await expect(page.locator('main')).toBeVisible();
        await expect(page.locator('[data-boot-skeleton]')).toHaveCount(0);
        await expect(page.getByText('Access Denied', { exact: true })).toHaveCount(0);
        if (route.area === 'auth' || route.area === 'account') {
            await expect(page.locator('link[data-route-preload]')).toHaveCount(1);
        }
        if (route.area === 'admin' && /\/(?:billing|infrastructure|nests|ai|email|marketplace)(?:\/|$)/.test(new URL(route.url, 'http://fixture.test').pathname)) {
            expect(await page.locator('link[data-route-preload]').count()).toBeGreaterThanOrEqual(2);
        }
        if (route.area === 'server') {
            const pathname = new URL(route.url, 'http://fixture.test').pathname;
            if (/\/marketplace(?:\/|$)/.test(pathname)) {
                await expect(page.locator('link[data-route-preload]')).toHaveCount(1);
            }
            if (/\/(?:files|schedules)(?:\/|$)/.test(pathname)) {
                await expect(page.locator('link[data-route-preload]')).toHaveCount(2);
            }
        }
    });
}
