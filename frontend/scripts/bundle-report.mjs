import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)));
const buildDirectory = resolve(frontendDirectory, '../public/build');
const manifestPath = join(buildDirectory, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const shouldCheck = process.argv.includes('--check');

const routes = [
    { name: 'Guest landing', entry: 'src/public.tsx', catalog: 'virtual:m12-i18n-catalog/public/en', layout: null, source: null, cap: 345_000 },
    { name: 'Login', entry: 'src/public.tsx', catalog: 'virtual:m12-i18n-catalog/public/en', layout: 'src/layouts/AuthLayout.tsx', source: 'src/pages/auth/LoginPage.tsx', cap: 385_000 },
    { name: 'Dashboard', entry: 'src/main.tsx', catalog: 'virtual:m12-i18n-catalog/full/en', layout: 'src/layouts/DashboardLayout.tsx', source: 'src/pages/dashboard/DashboardPage.tsx', cap: 360_000 },
    { name: 'Server overview', entry: 'src/main.tsx', catalog: 'virtual:m12-i18n-catalog/full/en', layout: 'src/layouts/ServerLayout.tsx', source: 'src/pages/server/ServerOverviewPage.tsx', cap: 440_000 },
    {
        name: 'File manager',
        entry: 'src/main.tsx',
        catalog: 'virtual:m12-i18n-catalog/full/en',
        layout: 'src/layouts/ServerLayout.tsx',
        source: [
            'src/pages/server/files/FilesSection.tsx',
            'src/pages/server/files/components/FileBrowser.tsx',
        ],
        cap: 520_000,
    },
];

function closure(...roots) {
    const seen = new Set();
    const visit = key => {
        if (!key || seen.has(key)) return;
        const chunk = manifest[key];
        if (!chunk) throw new Error(`Manifest import ${JSON.stringify(key)} was not found.`);
        seen.add(key);
        for (const imported of chunk.imports ?? []) visit(imported);
    };
    roots.forEach(visit);
    return seen;
}

function summarize(keys) {
    let raw = 0;
    let gzip = 0;
    for (const key of keys) {
        const file = readFileSync(join(buildDirectory, manifest[key].file));
        raw += file.byteLength;
        gzip += gzipSync(file, { level: 9 }).byteLength;
    }
    return { requests: keys.size, raw, gzip };
}

function filesBelow(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? filesBelow(path) : [path];
    });
}

const routeRows = routes.map(route => {
    const sources = Array.isArray(route.source) ? route.source : [route.source];
    const keys = closure(route.entry, route.catalog, route.layout, ...sources);
    return { ...route, ...summarize(keys) };
});

const buildFiles = filesBelow(buildDirectory);
const totalBytes = buildFiles.reduce((sum, file) => sum + statSync(file).size, 0);
const manifestBytes = statSync(manifestPath).size;
const mainCssFiles = new Set(
    [...closure(routes[0].entry)].flatMap(key => manifest[key].css ?? []),
);
const mainCss = [...mainCssFiles].reduce((sum, file) => {
    const contents = readFileSync(join(buildDirectory, file));
    return sum + gzipSync(contents, { level: 9 }).byteLength;
}, 0);

console.log('Route bundle closures (entry + recursive static imports + English catalog)');
console.table(
    routeRows.map(row => ({
        Route: row.name,
        Requests: row.requests,
        'Raw JS': row.raw,
        'Gzip JS': row.gzip,
        'Initial cap': row.cap,
    })),
);
console.log(`Build output: ${buildFiles.length} files, ${totalBytes} bytes`);
console.log(`Manifest: ${manifestBytes} bytes`);
console.log(`Main CSS gzip: ${mainCss} bytes`);

if (!shouldCheck) process.exit(0);

const failures = [];
for (const row of routeRows) {
    if (row.gzip > row.cap) failures.push(`${row.name} gzip ${row.gzip} exceeds ${row.cap}`);
}
if (totalBytes > 7_000_000) failures.push(`Build output ${totalBytes} exceeds 7000000 bytes`);
if (manifestBytes > 155_000) failures.push(`Manifest ${manifestBytes} exceeds 155000 bytes`);
if (mainCss > 20_000) failures.push(`Main CSS gzip ${mainCss} exceeds 20000 bytes`);

if (failures.length) {
    console.error('\nBundle budget failed:');
    failures.forEach(failure => console.error(`- ${failure}`));
    process.exit(1);
}

console.log('Bundle budget passed.');
