import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { routes } = require('../lighthouse.routes.cjs');
const frontendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDirectory = resolve(frontendDirectory, '..');
const resultSet = process.env.LIGHTHOUSE_RESULT_SET ?? 'baseline';
if (!['baseline', 'optimized'].includes(resultSet)) {
    throw new Error('LIGHTHOUSE_RESULT_SET must be either baseline or optimized.');
}
const resultsDirectory = resolve(repositoryDirectory, `storage/app/lighthouse/${resultSet}`);
const reportPath = resolve(repositoryDirectory, `docs/baseline${resultSet === 'optimized' ? '_optimized' : ''}.md`);
const profiles = ['desktop', 'mobile'];
const areas = ['public', 'auth', 'account', 'server', 'admin'];

function routeFromUrl(value) {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
}

function readResults(profile) {
    const directory = resolve(resultsDirectory, profile);
    let fileNames;

    try {
        fileNames = readdirSync(directory).filter(fileName => fileName.endsWith('.report.json'));
    } catch {
        return new Map();
    }

    const results = new Map();
    for (const fileName of fileNames) {
        let report;
        try {
            report = JSON.parse(readFileSync(resolve(directory, fileName), 'utf8'));
        } catch {
            continue;
        }

        if (!report.requestedUrl) continue;
        const route = routeFromUrl(report.requestedUrl);
        const previous = results.get(route);
        if (!previous || Date.parse(report.fetchTime) > Date.parse(previous.fetchTime)) {
            results.set(route, report);
        }
    }

    return results;
}

function score(report, category) {
    const value = report?.categories?.[category]?.score;
    return typeof value === 'number' ? Math.round(value * 100) : null;
}

function auditValue(report, audit) {
    const value = report?.audits?.[audit]?.numericValue;
    return typeof value === 'number' ? value : null;
}

function requestCount(report) {
    const items = report?.audits?.['network-requests']?.details?.items;
    return Array.isArray(items) ? items.length : null;
}

function median(values) {
    const numeric = values.filter(value => typeof value === 'number').sort((left, right) => left - right);
    if (numeric.length === 0) return null;
    const middle = Math.floor(numeric.length / 2);
    return numeric.length % 2 === 0 ? (numeric[middle - 1] + numeric[middle]) / 2 : numeric[middle];
}

function formatMilliseconds(value) {
    return value === null ? '—' : `${Math.round(value).toLocaleString('en-US')} ms`;
}

function formatCls(value) {
    return value === null ? '—' : value.toFixed(3);
}

function formatBytes(value) {
    if (value === null) return '—';
    if (value < 1024) return `${Math.round(value)} B`;
    return `${(value / 1024).toFixed(1)} KiB`;
}

function formatScore(value) {
    return value === null ? '—' : String(value);
}

function metricRows(resultsByProfile) {
    const rows = [];
    for (const profile of profiles) {
        for (const area of areas) {
            const areaRoutes = routes.filter(route => route.area === area);
            const reports = areaRoutes.map(route => resultsByProfile[profile].get(route.url)).filter(Boolean);
            rows.push([
                profile[0].toUpperCase() + profile.slice(1),
                area[0].toUpperCase() + area.slice(1),
                `${reports.length}/${areaRoutes.length}`,
                formatScore(median(reports.map(report => score(report, 'performance')))),
                formatMilliseconds(median(reports.map(report => auditValue(report, 'first-contentful-paint')))),
                formatMilliseconds(median(reports.map(report => auditValue(report, 'largest-contentful-paint')))),
                formatMilliseconds(median(reports.map(report => auditValue(report, 'total-blocking-time')))),
                formatCls(median(reports.map(report => auditValue(report, 'cumulative-layout-shift')))),
                formatBytes(median(reports.map(report => auditValue(report, 'total-byte-weight')))),
            ]);
        }
    }
    return rows;
}

function markdownTable(headers, rows) {
    return [
        `| ${headers.join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
        ...rows.map(row => `| ${row.join(' | ')} |`),
    ].join('\n');
}

function routeTables(resultsByProfile) {
    const sections = [];
    for (const profile of profiles) {
        sections.push(`## ${profile[0].toUpperCase() + profile.slice(1)} pages`);
        for (const area of areas) {
            const rows = routes
                .filter(route => route.area === area)
                .map(route => {
                    const report = resultsByProfile[profile].get(route.url);
                    return [
                        route.name,
                        `\`${route.path}\``,
                        formatScore(score(report, 'performance')),
                        formatScore(score(report, 'accessibility')),
                        formatScore(score(report, 'best-practices')),
                        formatMilliseconds(auditValue(report, 'first-contentful-paint')),
                        formatMilliseconds(auditValue(report, 'largest-contentful-paint')),
                        formatMilliseconds(auditValue(report, 'total-blocking-time')),
                        formatCls(auditValue(report, 'cumulative-layout-shift')),
                        requestCount(report) ?? '—',
                        formatBytes(auditValue(report, 'total-byte-weight')),
                    ];
                });
            sections.push(
                `### ${area[0].toUpperCase() + area.slice(1)}`,
                markdownTable(
                    ['Page', 'Route', 'Perf', 'A11y', 'Best', 'FCP', 'LCP', 'TBT', 'CLS', 'Requests', 'Transfer'],
                    rows,
                ),
            );
        }
    }
    return sections.join('\n\n');
}

const resultsByProfile = Object.fromEntries(profiles.map(profile => [profile, readResults(profile)]));
const generatedAt = new Date().toISOString();
let commit = 'unknown';
try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: repositoryDirectory,
        encoding: 'utf8',
    }).trim();
} catch {
    // Keep report generation useful outside a Git checkout.
}

const covered = profiles.reduce(
    (count, profile) => count + routes.filter(route => resultsByProfile[profile].has(route.url)).length,
    0,
);
const expected = routes.length * profiles.length;
const title = resultSet === 'optimized' ? 'Lighthouse all-page optimized baseline' : 'Lighthouse all-page baseline';
const summary = resultSet === 'optimized'
    ? 'This is the completed post-optimization inventory. It uses the same production fixture and route catalog as `docs/baseline.md` so the two tables remain directly comparable.'
    : 'This is a one-run performance inventory of every rendered route in the frontend. It uses the production bundle and deterministic authenticated fixture data. Pages whose secondary API calls are not mocked intentionally measure their loading or error-empty state; use the same fixture when comparing future commits.';
const markdown = `# ${title}

Generated: ${generatedAt}  
Commit: \`${commit}\`  
Coverage: ${covered}/${expected} audits (${routes.length} pages across desktop and mobile)

${summary}

## Area medians

${markdownTable(
    ['Profile', 'Area', 'Coverage', 'Perf', 'FCP', 'LCP', 'TBT', 'CLS', 'Transfer'],
    metricRows(resultsByProfile),
)}

Scores are out of 100. Times are Lighthouse lab measurements. Transfer is the median total byte weight. A dash means that profile has not been collected for that route yet.

${routeTables(resultsByProfile)}
`;

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, markdown);
process.stdout.write(`Wrote ${reportPath} with ${covered}/${expected} audits.\n`);
