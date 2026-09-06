import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: './tests/e2e',
    outputDir: './test-results',
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 2 : undefined,
    reporter: process.env.CI
        ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
        : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'off',
    },
    webServer: process.env.PLAYWRIGHT_BASE_URL
        ? undefined
        : {
              command: `node tests/e2e/production-server.mjs --port=${port}`,
              url: `${baseURL}/__health`,
              reuseExistingServer: !process.env.CI,
              timeout: 30_000,
          },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
