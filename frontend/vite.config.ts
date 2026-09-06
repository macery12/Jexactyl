import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import laravel from 'laravel-vite-plugin';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { fileURLToPath, URL } from 'node:url';

const catalogPrefix = 'virtual:m12-i18n-catalog/';
const resolvedCatalogPrefix = `\0${catalogPrefix}`;
const generatedCatalogDirectory = fileURLToPath(new URL('./src/i18n/generated/', import.meta.url));

/** Keep generated catalog implementations out of TypeScript's source graph. */
function generatedCatalogPlugin(): Plugin {
    return {
        name: 'm12labs-generated-i18n-catalogs',
        resolveId(id) {
            return id.startsWith(catalogPrefix) ? `\0${id}` : null;
        },
        load(id) {
            if (!id.startsWith(resolvedCatalogPrefix)) return null;

            const [scope, locale, ...extra] = id.slice(resolvedCatalogPrefix.length).split('/');
            if (extra.length || !['full', 'public'].includes(scope ?? '') || !/^[A-Za-z0-9_-]+$/.test(locale ?? '')) {
                throw new Error(`Invalid generated locale catalog ${JSON.stringify(id)}`);
            }
            return readFileSync(`${generatedCatalogDirectory}${scope}/${locale}.js`, 'utf8');
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
        generatedCatalogPlugin(),
        react(),
        tailwindcss(),
        laravel({
            input: ['src/main.tsx', 'src/public.tsx'],
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
