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
            const fontPreloads = page.locator('link[data-server-font-preload]');
            await expect(fontPreloads).toHaveCount(2);
            expect(
                await fontPreloads.evaluateAll(links =>
                    links.map(link => {
                        const preload = link as HTMLLinkElement;
                        return {
                            as: preload.as,
                            crossOrigin: preload.crossOrigin,
                            href: new URL(preload.href).pathname,
                            rel: preload.rel,
                            type: preload.type,
                        };
                    }),
                ),
            ).toEqual([
                expect.objectContaining({
                    as: 'font',
                    crossOrigin: 'anonymous',
                    href: expect.stringMatching(/\/build\/assets\/ibm-plex-sans-latin-600-normal-[^/]+\.woff2$/),
                    rel: 'preload',
                    type: 'font/woff2',
                }),
                expect.objectContaining({
                    as: 'font',
                    crossOrigin: 'anonymous',
                    href: expect.stringMatching(/\/build\/assets\/ibm-plex-mono-latin-400-normal-[^/]+\.woff2$/),
                    rel: 'preload',
                    type: 'font/woff2',
                }),
            ]);
            if (/\/marketplace(?:\/|$)/.test(pathname)) {
                await expect(page.locator('link[data-route-preload]')).toHaveCount(1);
            }
            if (/\/(?:files|schedules)(?:\/|$)/.test(pathname)) {
                await expect(page.locator('link[data-route-preload]')).toHaveCount(2);
            }
        }
    });
}
