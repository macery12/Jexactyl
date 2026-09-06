import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const frontendDirectory = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const publicDirectory = resolve(frontendDirectory, '../public');
const buildDirectory = resolve(publicDirectory, 'build');
const manifestPath = join(buildDirectory, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entryKey = 'src/public.tsx';
const entry = manifest[entryKey];
const localeKey = 'virtual:m12-i18n-catalog/public/en';
const localeEntry = manifest[localeKey];
const authRouteEntries = [
    [/^\/auth\/login$/, 'src/pages/auth/LoginPage.tsx'],
    [/^\/auth\/login\/checkpoint$/, 'src/pages/auth/CheckpointPage.tsx'],
    [/^\/auth\/register$/, 'src/pages/auth/RegisterPage.tsx'],
    [/^\/auth\/password$/, 'src/pages/auth/ForgotPasswordPage.tsx'],
    [/^\/auth\/password\/reset\/[^/]+$/, 'src/pages/auth/ResetPasswordPage.tsx'],
    [/^\/auth\/sso\/link-choice$/, 'src/pages/auth/SsoLinkChoicePage.tsx'],
    [/^\/auth\/sso\/register$/, 'src/pages/auth/SsoRegisterPage.tsx'],
];
const authLayoutKey = 'src/layouts/AuthLayout.tsx';
const bootSkeleton = readFileSync(
    resolve(frontendDirectory, '../resources/views/templates/v2/skeleton.blade.php'),
    'utf8',
);

if (!entry?.file) {
    throw new Error(`Missing ${entryKey} entry in ${manifestPath}; run pnpm build:frontend first.`);
}
if (!localeEntry?.file) {
    throw new Error(`Missing ${localeKey} entry in ${manifestPath}; run pnpm build:frontend first.`);
}

function resolveImports(key, seen = new Set()) {
    for (const importedKey of manifest[key]?.imports ?? []) {
        if (seen.has(importedKey)) continue;
        seen.add(importedKey);
        resolveImports(importedKey, seen);
    }
    return seen;
}

const entryClosureKeys = [entryKey, ...resolveImports(entryKey)];
const modulePreloadFiles = entryClosureKeys
    .map(key => manifest[key]?.file)
    .filter(Boolean);
const entryCssFiles = [...new Set(entryClosureKeys.flatMap(key => manifest[key]?.css ?? []))];

const portArgument = process.argv.find(argument => argument.startsWith('--port='));
const port = Number(portArgument?.slice('--port='.length) ?? process.env.PORT ?? 4173);

const siteConfiguration = {
    name: 'M12Labs Test Panel',
    logo: null,
    mode: 'production',
    setup: true,
    debug: false,
    locale: 'en',
    user_locale: true,
    command_palette: true,
    quick_tabs: true,
    captcha: { enabled: false, siteKey: '' },
    activity: { enabled: { account: true, server: true, admin: true } },
};

const everestConfiguration = {
    auth: {
        registration: { enabled: true },
        security: { force2fa: false },
        captcha: { provider: 'turnstile', site_key: '' },
        modules: {
            discord: { enabled: false },
            google: { enabled: false },
            onboarding: { enabled: false },
            jguard: { enabled: false },
        },
    },
    tickets: { enabled: true, maxCount: 5 },
    billing: {
        enabled: false,
        currency: { symbol: '$', code: 'USD' },
        links: { terms: '', privacy: '' },
    },
    ai: { enabled: false, feature_agent: false, feature_admin_agent: false },
    mods: { enabled: false },
    webhooks: { enabled: false },
    email: { enabled: false, module_enabled: false },
    extensions: { enabled: false, active: [] },
    custom_domains: { enabled: false },
};

function escapeScriptJson(value) {
    return JSON.stringify(value)
        .replaceAll('<', '\\u003c')
        .replaceAll('>', '\\u003e')
        .replaceAll('&', '\\u0026')
        .replaceAll('\u2028', '\\u2028')
        .replaceAll('\u2029', '\\u2029');
}

function documentHtml(pathname) {
    // Match Illuminate\Foundation\Vite's production output so Lighthouse does
    // not measure an artificial main-entry-to-static-import waterfall.
    const modulePreloads = modulePreloadFiles
        .map(file => `<link rel="modulepreload" as="script" href="/build/${file}">`)
        .join('');
    const styles = entryCssFiles
        .map(file => `<link rel="stylesheet" href="/build/${file}">`)
        .join('');
    const localePreload = `<link rel="modulepreload" as="script" data-locale-preload href="/build/${localeEntry.file}">`;
    const routeKey = authRouteEntries.find(([pattern]) => pattern.test(pathname))?.[1];
    const routeFile = routeKey ? manifest[routeKey]?.file : null;
    const routePreload = routeFile
        ? `<link rel="modulepreload" as="script" data-route-preload href="/build/${routeFile}">`
        : '';
    const layoutFile = pathname.startsWith('/auth/') ? manifest[authLayoutKey]?.file : null;
    const layoutPreload = layoutFile
        ? `<link rel="modulepreload" as="script" data-layout-preload href="/build/${layoutFile}">`
        : '';

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="csrf-token" content="playwright-csrf-token">
  <meta name="robots" content="noindex">
  <title>M12Labs Test Panel</title>
  <script>window.SiteConfiguration=${escapeScriptJson(siteConfiguration)};window.EverestConfiguration=${escapeScriptJson(everestConfiguration)};</script>
  ${modulePreloads}
  ${styles}
  <script type="module" src="/build/${entry.file}"></script>
  ${localePreload}
  ${layoutPreload}
  ${routePreload}
</head>
<body><div id="app">${bootSkeleton}</div></body>
</html>`;
}

const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

function serveAsset(request, requestPath, response) {
    const relativePath = normalize(requestPath.replace(/^\/build\//, ''));
    const filePath = resolve(buildDirectory, relativePath);
    if (!filePath.startsWith(`${buildDirectory}/`)) return false;

    try {
        const stat = statSync(filePath);
        if (!stat.isFile()) return false;
        const contentType = contentTypes[extname(filePath)] ?? 'application/octet-stream';
        const gzip = /\bgzip\b/.test(request.headers['accept-encoding'] ?? '') &&
            /^(?:text\/|application\/(?:json|javascript))/.test(contentType);
        const headers = {
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Content-Type': contentType,
            Vary: 'Accept-Encoding',
        };
        if (gzip) {
            response.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
            createReadStream(filePath).pipe(createGzip({ level: 9 })).pipe(response);
        } else {
            response.writeHead(200, { ...headers, 'Content-Length': stat.size });
            createReadStream(filePath).pipe(response);
        }
        return true;
    } catch {
        return false;
    }
}

const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

    if (url.pathname === '/__health') {
        response.writeHead(204).end();
        return;
    }

    if (url.pathname.startsWith('/build/') && serveAsset(request, url.pathname, response)) return;

    if (url.pathname === '/sanctum/csrf-cookie') {
        response.writeHead(204, {
            'Cache-Control': 'no-store',
            'Set-Cookie': 'XSRF-TOKEN=playwright-csrf-token; Path=/; SameSite=Lax',
        }).end();
        return;
    }

    if (url.pathname.startsWith('/api/') || (request.method !== 'GET' && request.method !== 'HEAD')) {
        response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ errors: [{ detail: 'Not available in the public browser fixture.' }] }));
        return;
    }

    const html = documentHtml(url.pathname);
    response.writeHead(200, {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        'Content-Length': Buffer.byteLength(html),
        'Content-Type': 'text/html; charset=utf-8',
    });
    response.end(html);
});

server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`Production browser fixture listening on http://127.0.0.1:${port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
}
