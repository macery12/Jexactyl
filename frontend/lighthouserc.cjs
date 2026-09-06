const reportDirectory = '../storage/app/lighthouse';

module.exports = {
    ci: {
        collect: {
            startServerCommand: 'node tests/e2e/production-server.mjs --port=4173',
            startServerReadyPattern: 'Production browser fixture listening',
            url: ['http://127.0.0.1:4173/', 'http://127.0.0.1:4173/auth/login'],
            numberOfRuns: 3,
            settings: {
                chromeFlags: '--headless --no-sandbox --disable-dev-shm-usage',
                preset: 'desktop',
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
                'resource-summary:stylesheet:size': ['error', { maxNumericValue: 20000 }],
            },
        },
        upload: {
            target: 'filesystem',
            outputDir: reportDirectory,
        },
    },
};
