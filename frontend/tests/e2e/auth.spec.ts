import { expect, test } from '@playwright/test';
import { expectNoHighImpactAxeViolations } from './accessibility';

test.describe('guest authentication routes', () => {
    test('SSO registration keeps its loading state layout-stable', async ({ page }) => {
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

        await page.route('**/auth/sso/registration-data', async route => {
            await new Promise(resolve => setTimeout(resolve, 750));
            await route.fulfill({
                json: {
                    provider: 'discord',
                    provider_label: 'Discord',
                    username: 'lighthouse-user',
                    email: 'lighthouse@example.test',
                    provider_user_id: '123456789',
                    email_taken: false,
                    registration_enabled: true,
                },
            });
        });

        await page.goto('/auth/sso/register');
        await expect(page.getByRole('heading', { level: 1, name: /finish your discord sign-up/i })).toBeVisible();
        await page.waitForTimeout(100);

        const cumulativeLayoutShift = await page.evaluate(
            () => (window as typeof window & { __cumulativeLayoutShift?: number }).__cumulativeLayoutShift ?? 0,
        );
        expect(cumulativeLayoutShift).toBeLessThan(0.1);
    });

    test('registration exposes a complete accessible form', async ({ page }) => {
        await page.goto('/auth/register');

        await expect(page.getByRole('heading', { level: 1, name: /create your account/i })).toBeVisible();
        await expect(page.getByLabel(/^username$/i)).toBeVisible();
        await expect(page.getByLabel(/email/i)).toBeVisible();
        await expect(page.getByLabel(/^password$/i)).toBeVisible();
        await expect(page.getByLabel(/confirm password/i)).toBeVisible();
        await expectNoHighImpactAxeViolations(page);
    });

    test('password recovery falls back to the email shell safely', async ({ page }) => {
        await page.goto('/auth/password');

        await expect(page.getByRole('heading', { level: 1, name: /reset your password/i })).toBeVisible();
        await expect(page.getByLabel(/email/i)).toBeVisible();
        await expect(page.getByRole('button', { name: /send reset link/i })).toBeVisible();
        await expectNoHighImpactAxeViolations(page);
    });

    test('an incomplete reset link renders a safe, accessible error state', async ({ page }) => {
        await page.goto('/auth/password/reset/incomplete');

        await expect(page.getByRole('heading', { level: 1, name: /set a new password/i })).toBeVisible();
        await expect(page.getByRole('alert')).toContainText(/reset link is invalid or incomplete/i);
        await expectNoHighImpactAxeViolations(page);
    });
});
