import { expect, test } from '@playwright/test';
import { expectNoHighImpactAxeViolations } from './accessibility';

test.describe('public landing', () => {
    test('shows a server-rendered shell before JavaScript starts', async ({ page }) => {
        await page.route(/\/build\/assets\/main-[^/]+\.js$/, route => route.abort());
        await page.goto('/');

        await expect(page.locator('#app > [data-boot-skeleton]')).toBeVisible();
    });

    test('renders useful content and navigates to sign in', async ({ page }) => {
        await page.goto('/');

        await expect(page).toHaveTitle('M12Labs Test Panel');
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByRole('main')).toBeVisible();
        await expect(page.locator('[data-boot-skeleton]')).toHaveCount(0);
        const localeMeasures = await page.evaluate(() =>
            performance.getEntriesByName('m12:i18n:en', 'measure').map(entry => entry.duration),
        );
        expect(localeMeasures).toHaveLength(1);

        await page.getByRole('link', { name: /sign in/i }).click();
        await expect(page).toHaveURL(/\/auth\/login$/);
        await expect(page.getByRole('heading', { level: 1, name: /welcome back/i })).toBeVisible();
    });

    test('serves private HTML and compressed immutable build assets', async ({ page }) => {
        const documentResponsePromise = page.waitForResponse(response => response.request().resourceType() === 'document');
        const scriptResponsePromise = page.waitForResponse(response =>
            /\/build\/assets\/main-[^/]+\.js$/.test(response.url()),
        );
        await page.goto('/');

        const documentHeaders = (await documentResponsePromise).headers();
        const scriptHeaders = (await scriptResponsePromise).headers();
        expect(documentHeaders['cache-control']).toContain('no-store');
        expect(scriptHeaders['cache-control']).toContain('immutable');
        expect(scriptHeaders['content-encoding']).toBe('gzip');
        expect(scriptHeaders.vary).toContain('Accept-Encoding');
    });

    test('mirrors Laravel production module preloads', async ({ page }) => {
        await page.goto('/');

        const preloadUrls = await page.locator('link[rel="modulepreload"][as="script"]').evaluateAll(links =>
            links.map(link => (link as HTMLLinkElement).href),
        );
        expect(preloadUrls.length).toBeGreaterThan(1);
        expect(new Set(preloadUrls).size).toBe(preloadUrls.length);
        expect(preloadUrls.every(url => new URL(url).pathname.startsWith('/build/assets/'))).toBe(true);
    });

    test('has no serious or critical automated accessibility findings', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectNoHighImpactAxeViolations(page);
    });

    test('keeps the decorative cockpit static with reduced motion', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/');

        const cockpit = page.locator('[data-landing-cockpit]');
        await expect(cockpit).toBeVisible();
        const initialText = await cockpit.textContent();
        await page.waitForTimeout(2_100);
        await expect(cockpit).toHaveText(initialText ?? '');
    });
});

test.describe('login', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/auth/login');
        await expect(page.getByRole('heading', { level: 1, name: /welcome back/i })).toBeVisible();
    });

    test('supports labels, keyboard order, validation, and announced errors', async ({ page }) => {
        const username = page.getByLabel(/username or email/i);
        const password = page.getByLabel(/^password$/i);
        const remember = page.locator('#remember');
        const submit = page.getByRole('button', { name: /sign in/i });

        await page.keyboard.press('Tab');
        await expect(username).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(password).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(remember).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(submit).toBeFocused();

        await submit.click();
        const alert = page.getByRole('alert');
        await expect(alert).toBeVisible();
        await expect(username).toHaveAttribute('aria-invalid', 'true');
        await expect(username).toHaveAttribute('aria-describedby', /\S+/);
    });

    test('has no serious or critical automated accessibility findings', async ({ page }) => {
        await expectNoHighImpactAxeViolations(page);
    });
});
