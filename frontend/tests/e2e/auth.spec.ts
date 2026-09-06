import { expect, test } from '@playwright/test';
import { expectNoHighImpactAxeViolations } from './accessibility';

test.describe('guest authentication routes', () => {
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
