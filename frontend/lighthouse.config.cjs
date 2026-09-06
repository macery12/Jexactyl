const { existsSync, readdirSync } = require('node:fs');
const { join, resolve } = require('node:path');

const browserDirectory = resolve(__dirname, '../.playwright-browsers');

function findExecutable(directory, fileName) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isFile() && entry.name === fileName) return path;
        if (entry.isDirectory()) {
            const nested = findExecutable(path, fileName);
            if (nested) return nested;
        }
    }
    return null;
}

function chromePath() {
    if (!existsSync(browserDirectory)) {
        throw new Error('Pinned Chromium is missing; run pnpm --dir frontend playwright:install.');
    }

    const executableName = process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';
    const shellDirectories = readdirSync(browserDirectory)
        .filter(name => name.startsWith('chromium_headless_shell-'))
        .sort()
        .reverse();

    for (const directory of shellDirectories) {
        const executable = findExecutable(join(browserDirectory, directory), executableName);
        if (executable) return executable;
    }

    throw new Error('Playwright Chromium headless shell is missing; rerun the browser installation.');
}

const routes = ['http://127.0.0.1:4173/', 'http://127.0.0.1:4173/auth/login'];

const profiles = {
    desktop: {
        preset: 'desktop',
    },
    mobile: {},
};

function numberOfRuns() {
    const value = Number(process.env.LIGHTHOUSE_RUNS ?? 3);
    if (!Number.isInteger(value) || value < 1) {
        throw new Error('LIGHTHOUSE_RUNS must be a positive integer.');
    }
    return value;
}

function createLighthouseConfig(profile) {
    const settings = profiles[profile];
    if (!settings) throw new Error(`Unknown Lighthouse profile: ${profile}`);

    return {
        ci: {
            collect: {
                chromePath: chromePath(),
                startServerCommand: 'node tests/e2e/production-server.mjs --port=4173',
                startServerReadyPattern: 'Production browser fixture listening',
                url: routes,
                numberOfRuns: numberOfRuns(),
                settings: {
                    chromeFlags: '--headless --no-sandbox --disable-dev-shm-usage',
                    ...settings,
                },
            },
            assert: {
                assertions: {
                    'categories:performance': ['warn', { minScore: 0.85 }],
                    'categories:accessibility': ['error', { minScore: 0.98 }],
                    'categories:best-practices': ['error', { minScore: 0.95 }],
                    'largest-contentful-paint': ['warn', { maxNumericValue: 3000 }],
                    'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
                    'total-blocking-time': ['warn', { maxNumericValue: 250 }],
                    'resource-summary:script:size': ['warn', { maxNumericValue: 385000 }],
                    'resource-summary:script:count': ['warn', { maxNumericValue: 40 }],
                    'resource-summary:stylesheet:size': ['error', { maxNumericValue: 20000 }],
                    'resource-summary:total:size': ['warn', { maxNumericValue: 600000 }],
                },
            },
            upload: {
                target: 'filesystem',
                outputDir: `../storage/app/lighthouse/${profile}`,
            },
        },
    };
}

module.exports = { createLighthouseConfig };
