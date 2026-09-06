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
const entryKeys = {
    public: 'src/public.tsx',
    authenticated: 'src/main.tsx',
};
const localeKeys = {
    public: 'virtual:m12-i18n-catalog/public/en',
    authenticated: 'virtual:m12-i18n-catalog/full/en',
};
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
const dashboardLayoutKey = 'src/layouts/DashboardLayout.tsx';
const serverLayoutKey = 'src/layouts/ServerLayout.tsx';
const adminLayoutKey = 'src/layouts/AdminLayout.tsx';
const bootSkeleton = readFileSync(
    resolve(frontendDirectory, '../resources/views/templates/v2/skeleton.blade.php'),
    'utf8',
);

for (const key of [...Object.values(entryKeys), ...Object.values(localeKeys)]) {
    if (!manifest[key]?.file) {
        throw new Error(`Missing ${key} entry in ${manifestPath}; run pnpm build:frontend first.`);
    }
}

function resolveImports(key, seen = new Set()) {
    for (const importedKey of manifest[key]?.imports ?? []) {
        if (seen.has(importedKey)) continue;
        seen.add(importedKey);
        resolveImports(importedKey, seen);
    }
    return seen;
}

function frontendAssets(authenticated) {
    const scope = authenticated ? 'authenticated' : 'public';
    const entryKey = entryKeys[scope];
    const localeKey = localeKeys[scope];
    const entryClosureKeys = [entryKey, ...resolveImports(entryKey)];

    return {
        entry: manifest[entryKey],
        localeEntry: manifest[localeKey],
        modulePreloadFiles: entryClosureKeys.map(key => manifest[key]?.file).filter(Boolean),
        entryCssFiles: [...new Set(entryClosureKeys.flatMap(key => manifest[key]?.css ?? []))],
    };
}

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

const authenticatedUser = {
    uuid: '00000000-0000-4000-8000-000000000001',
    username: 'lighthouse-admin',
    email: 'lighthouse@example.test',
    root_admin: true,
    use_totp: true,
    language: 'en',
    avatar_url: '',
    admin_role_name: 'Owner',
    admin_role_id: 1,
    access_profile: { id: 1, name: 'Owner', color: '#0047fc', is_owner: true },
    state: 'active',
    email_verified: true,
    email_verified_at: '2026-09-06T00:00:00.000Z',
    updated_at: '2026-09-06T00:00:00.000Z',
    created_at: '2026-09-06T00:00:00.000Z',
    discord_linked: true,
};

const everestConfiguration = {
    auth: {
        registration: { enabled: true },
        security: { force2fa: false },
        captcha: { provider: 'turnstile', site_key: '' },
        modules: {
            discord: { enabled: true },
            google: { enabled: true },
            onboarding: { enabled: true, content: '' },
            jguard: { enabled: true, approval_mode: 'manual', delay: 0 },
        },
    },
    tickets: { enabled: true, maxCount: 5 },
    billing: {
        enabled: true,
        processors: {
            stripe: { available: false, enabled: false },
            paypal: { available: false, enabled: false },
        },
        currency: { symbol: '$', code: 'USD' },
        links: { terms: '', privacy: '' },
        store: { enabled: true, sections: [] },
    },
    ai: { enabled: true, feature_agent: true, feature_admin_agent: true },
    mods: { enabled: true },
    webhooks: { enabled: true },
    email: { enabled: true, module_enabled: true },
    extensions: { enabled: true, active: ['node_health_history'] },
    custom_domains: { enabled: true },
};

const fixtureServer = {
    object: 'server',
    attributes: {
        identifier: 'fixture',
        internal_id: 1,
        uuid: '',
        name: 'Lighthouse Fixture Server',
        server_owner: true,
        description: 'Deterministic server used by the all-page Lighthouse baseline.',
        node: 'Fixture Node',
        status: 'running',
        is_node_under_maintenance: false,
        is_transferring: false,
        is_node_supercharged: false,
        is_deletion_scheduled: false,
        docker_image: 'ghcr.io/example/fixture:latest',
        limits: { memory: 4096, disk: 20480, cpu: 200 },
        feature_limits: { databases: 4, allocations: 4, backups: 4, subusers: 4 },
        sftp_details: { ip: '127.0.0.1', port: 2022 },
        egg_id: 1,
        billing_product_id: null,
        billing_days: null,
        renewal_date: null,
        relationships: {
            allocations: {
                object: 'list',
                data: [
                    {
                        object: 'allocation',
                        attributes: { id: 1, ip: '127.0.0.1', ip_alias: null, port: 25565, is_default: true },
                    },
                ],
            },
        },
    },
    meta: { is_server_owner: true, user_permissions: ['*'] },
};

function escapeScriptJson(value) {
    return JSON.stringify(value)
        .replaceAll('<', '\\u003c')
        .replaceAll('>', '\\u003e')
        .replaceAll('&', '\\u0026')
        .replaceAll('\u2028', '\\u2028')
        .replaceAll('\u2029', '\\u2029');
}

function documentHtml(pathname, authenticated) {
    const { entry, localeEntry, modulePreloadFiles, entryCssFiles } = frontendAssets(authenticated);
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
    const layoutKey = pathname.startsWith('/auth/')
        ? authLayoutKey
        : pathname.startsWith('/server/')
          ? serverLayoutKey
          : pathname === '/admin' || pathname.startsWith('/admin/')
            ? adminLayoutKey
            : authenticated
              ? dashboardLayoutKey
              : null;
    const layoutFile = layoutKey ? manifest[layoutKey]?.file : null;
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
  <script>window.SiteConfiguration=${escapeScriptJson(siteConfiguration)};window.EverestConfiguration=${escapeScriptJson(everestConfiguration)};${authenticated ? `window.PterodactylUser=${escapeScriptJson(authenticatedUser)};` : ''}</script>
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

function sendJson(response, body, status = 200) {
    const json = JSON.stringify(body);
    response.writeHead(status, {
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(json),
        'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(json);
}

function serveFixtureApi(url, response) {
    if (url.pathname === '/api/application/permissions') {
        sendJson(response, { attributes: { permissions: [['*']] } });
        return true;
    }

    if (url.pathname === '/api/client') {
        sendJson(response, { object: 'list', data: [fixtureServer], meta: { pagination: { total: 1, count: 1 } } });
        return true;
    }

    if (/^\/api\/client\/servers\/fixture$/.test(url.pathname)) {
        sendJson(response, fixtureServer);
        return true;
    }

    if (/^\/api\/client\/servers\/fixture\/resources$/.test(url.pathname)) {
        sendJson(response, {
            object: 'stats',
            attributes: {
                current_state: 'running',
                is_suspended: false,
                resources: {
                    memory_bytes: 536_870_912,
                    cpu_absolute: 12.5,
                    disk_bytes: 2_147_483_648,
                    network_rx_bytes: 1_048_576,
                    network_tx_bytes: 524_288,
                    uptime: 3_600_000,
                },
            },
        });
        return true;
    }

    return false;
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

    if (request.method === 'GET' && serveFixtureApi(url, response)) return;

    if (url.pathname.startsWith('/api/') || (request.method !== 'GET' && request.method !== 'HEAD')) {
        response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ errors: [{ detail: 'Not available in the public browser fixture.' }] }));
        return;
    }

    const authenticated = url.searchParams.get('__lighthouse_auth') === '1';
    const html = documentHtml(url.pathname, authenticated);
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
