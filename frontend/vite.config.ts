import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import laravel from 'laravel-vite-plugin';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { fileURLToPath, URL } from 'node:url';

// Self-contained v2 UI. Builds into the Laravel public dir at `public/build`
// and writes its dev hot-file to `public/hot`, so it can be served by the
// existing Laravel app at `/v2` without touching the V1 build pipeline.
export default defineConfig(({ command }) => ({
    plugins: [
        // Compiles the inlang project (messages/*.json) into typed message
        // functions under src/paraglide. Locale reads/writes are overridden in
        // src/i18n to preserve the panel's existing precedence (see that file);
        // the strategy here is just the compile-time default.
        //
        // Dev only (`command === 'serve'`): here it compiles on boot and watches
        // messages/*.json for live recompiles. In `vite build` we deliberately
        // omit it — the `build` script's `paraglide-js compile` step already
        // writes src/paraglide before tsc runs, and leaving the plugin in would
        // recompile the whole project a second time (~8-16s of pure duplication).
        // We also drop emitTsDeclarations: tsconfig's `allowJs` lets TS read the
        // types straight from the generated .js JSDoc, so m['x']() typo-safety is
        // preserved without emitting ~1,700 extra .d.ts files.
        ...(command === 'serve'
            ? [
                  paraglideVitePlugin({
                      project: './project.inlang',
                      outdir: './src/paraglide',
                      strategy: ['localStorage', 'baseLocale'],
                      localStorageKey: 'm12labs.locale',
                  }),
              ]
            : []),
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
