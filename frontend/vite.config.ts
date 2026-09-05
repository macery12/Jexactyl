import { readFileSync } from 'node:fs';
import { defineConfig, normalizePath, type Plugin } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import laravel from 'laravel-vite-plugin';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { fileURLToPath, URL } from 'node:url';

const catalogPrefix = 'virtual:m12-i18n-catalog/';
const resolvedCatalogPrefix = `\0${catalogPrefix}`;
const messageIndex = fileURLToPath(new URL('./src/paraglide/messages/_index.js', import.meta.url));
const messageDirectory = fileURLToPath(new URL('./src/paraglide/messages/', import.meta.url));

/**
 * Turn Paraglide's generated locale modules into one browser chunk per locale.
 * `_index.js` is used only as a build-time name map; importing it directly would
 * pull every locale back into the browser graph.
 */
function localeCatalogPlugin(): Plugin {
    return {
        name: 'm12labs-locale-catalogs',
        resolveId(id) {
            return id.startsWith(catalogPrefix) ? `\0${id}` : null;
        },
        load(id) {
            if (!id.startsWith(resolvedCatalogPrefix)) return null;

            const locale = id.slice(resolvedCatalogPrefix.length);
            if (!/^[A-Za-z0-9_-]+$/.test(locale)) {
                throw new Error(`Invalid generated locale ${JSON.stringify(locale)}`);
            }

            const indexSource = readFileSync(messageIndex, 'utf8');
            const mappings = [...indexSource.matchAll(/^export \{ ([A-Za-z_$][\w$]*) as ("(?:\\.|[^"])*") \}$/gm)].map(
                match => ({ exportName: match[1]!, messageId: JSON.parse(match[2]!) as string }),
            );
            if (mappings.length === 0) {
                throw new Error(`No generated messages found in ${messageIndex}`);
            }

            const localeModule = normalizePath(`${messageDirectory}${locale}.js`);
            return [
                `import * as compiled from ${JSON.stringify(localeModule)};`,
                'const catalog = {',
                ...mappings.map(({ exportName, messageId }) => `    ${JSON.stringify(messageId)}: compiled.${exportName},`),
                '};',
                'export default catalog;',
            ].join('\n');
        },
    };
}

// Self-contained v2 UI. Builds into the Laravel public dir at `public/build`
// and writes its dev hot-file to `public/hot`, so it can be served by the
// existing Laravel app at `/v2` without touching the V1 build pipeline.
export default defineConfig(({ command }) => ({
    plugins: [
        // Compile messages/*.json for hot reload in development. Production uses
        // scripts/compile-i18n.mjs before tsc, with a content-hash cache so an
        // extension rebuild does not pay the Paraglide compile cost unnecessarily.
        //
        // Dev only (`command === 'serve'`): here it compiles on boot and watches
        // messages/*.json for live recompiles. In `vite build` we deliberately
        // omit it to avoid compiling twice. Locale-module output keeps generated
        // file count tiny; the compact typed facade is generated separately.
        ...(command === 'serve'
            ? [
                  paraglideVitePlugin({
                      project: './project.inlang',
                      outdir: './src/paraglide',
                      strategy: ['localStorage', 'baseLocale'],
                      localStorageKey: 'm12labs.locale',
                      outputStructure: 'locale-modules',
                  }),
              ]
            : []),
        localeCatalogPlugin(),
        react(),
        tailwindcss(),
        laravel({
            input: ['src/main.tsx'],
            publicDirectory: '../public',
            buildDirectory: 'build',
            hotFile: '../public/hot',
            refresh: false,
        }),
    ],

    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },

    build: {
        emptyOutDir: true,
        target: 'es2022',
    },

    server: {
        port: 5174,
        strictPort: true,
        cors: { origin: '*' },
    },
}));
