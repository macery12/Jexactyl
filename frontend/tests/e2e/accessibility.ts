import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export async function expectNoHighImpactAxeViolations(page: Page) {
    const results = await new AxeBuilder({ page }).analyze();
    const highImpact = results.violations.filter(violation =>
        violation.impact === 'serious' || violation.impact === 'critical',
    );

    expect(highImpact, highImpact.map(violation => `${violation.id}: ${violation.help}`).join('\n')).toEqual([]);
}
