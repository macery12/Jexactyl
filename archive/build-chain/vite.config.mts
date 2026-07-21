import babel from '@rolldown/plugin-babel';
import react from '@vitejs/plugin-react';
import laravel from 'laravel-vite-plugin';
import { dirname, resolve } from 'pathe';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const plugins = [
    react(),
    babel({
        include: /resources\/scripts\/.*\.[jt]sx?$/,
        plugins: ['babel-plugin-macros', 'babel-plugin-styled-components'],
    }),
];

if (process.env.VITEST === undefined) {
    plugins.push(
        laravel({
            input: 'resources/scripts/index.tsx',
        }),
    );
}

export default defineConfig({
    define:
        process.env.VITEST === undefined
            ? {
                  'process.env': {},
                  'process.platform': null,
                  'process.version': null,
                  'process.versions': null,
              }
            : undefined,

    plugins,

    build: {
        target: 'es2019',
        // Keep lazy-route dependencies truly lazy; this improves fresh-cache first paint
        // by avoiding eager preload of heavy route chunks from the entry page.
        modulePreload: false,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    // Keep Vite runtime helpers in an always-loaded runtime chunk.
                    // Otherwise Rollup can place the preload helper into a large feature chunk,
                    // forcing that chunk onto the initial page load.
                    if (id.includes('vite/preload-helper')) return 'vendor-react';
                    if (
                        id.includes('twin.macro') ||
                        id.includes('babel-plugin-macros') ||
                        id.includes('babel-plugin-styled-components')
                    ) return 'vendor-macros';
                    if (!id.includes('node_modules')) return;
                    // CodeMirror core runtime + @codemirror/view + Lezer parser runtime.
                    // @codemirror/view MUST be in the same chunk as @codemirror/state: they share
                    // circular file-level dependencies, so splitting them across chunks causes a TDZ
                    // crash ("Cannot access 'x' before initialization") at module evaluation time.
                    // language-data is metadata only (each language's load() uses a dynamic import),
                    // so it belongs here rather than inflating a lang chunk.
                    if (
                        id.includes('@codemirror/view') ||
                        id.includes('@codemirror/state') ||
                        id.includes('@codemirror/commands') ||
                        id.includes('@codemirror/autocomplete') ||
                        id.includes('@codemirror/language/') ||   // base package, not language-data
                        id.includes('@codemirror/language-data') ||
                        id.includes('@codemirror/lint') ||
                        id.includes('@codemirror/search') ||
                        id.includes('@lezer/common') ||
                        id.includes('@lezer/lr') ||
                        id.includes('@lezer/highlight')
                    ) return 'vendor-editor-core';
                    // @codemirror/legacy-modes, @codemirror/lang-*, and @lezer/* language parsers are
                    // intentionally NOT assigned to a manual chunk.
                    // - legacy-modes is only statically imported for the `shell` mode inside the lazy
                    //   EggInstallContainer chunk, so it costs nothing on the initial page load.
                    // - @codemirror/language-data references every other language via a dynamic import()
                    //   inside its load() method, so Rollup creates small per-language async chunks that
                    //   are fetched on demand when the user opens a file of that type.
                    // xterm terminal emulator and addons
                    if (id.includes('xterm')) return 'vendor-terminal';
                    // Chart.js and react-chartjs-2
                    if (id.includes('chart.js') || id.includes('react-chartjs-2')) return 'vendor-charts';
                    // Stripe payment libraries
                    if (id.includes('@stripe')) return 'vendor-stripe';
                    // State management: easy-peasy wraps immer + redux
                    if (
                        id.includes('easy-peasy') ||
                        id.includes('/immer/') ||
                        id.includes('/redux/') ||
                        id.includes('/redux-thunk/')
                    )
                        return 'vendor-state';
                    // Framer Motion animation runtime
                    if (id.includes('framer-motion')) return 'vendor-motion';
                    // CSS-in-JS runtime (styled-components)
                    if (id.includes('styled-components')) return 'vendor-styled';
                    // Preact/compat (react alias), React Router, and FontAwesome.
                    // FontAwesome calls React.forwardRef() at module evaluation time (top-level), so it
                    // MUST be in the same chunk as preact/compat to guarantee correct init order.
                    if (
                        id.includes('preact') ||
                        id.includes('react-router') ||
                        id.includes('@remix-run') ||
                        id.includes('@fortawesome')
                    )
                        return 'vendor-react';

                    return undefined;
                },
            },
        },
    },

    server: {
        cors: {
            origin: '*',
        },
    },

    resolve: {
        alias: {
            '@': resolve(dirname(fileURLToPath(import.meta.url)), 'resources', 'scripts'),
            '@definitions': resolve(
                dirname(fileURLToPath(import.meta.url)),
                'resources',
                'scripts',
                'api',
                'definitions',
            ),
            '@feature': resolve(
                dirname(fileURLToPath(import.meta.url)),
                'resources',
                'scripts',
                'components',
                'server',
                'features',
            ),
            '@account': resolve(
                dirname(fileURLToPath(import.meta.url)),
                'resources',
                'scripts',
                'components',
                'account',
            ),
            '@server': resolve(dirname(fileURLToPath(import.meta.url)), 'resources', 'scripts', 'components', 'server'),
            '@admin': resolve(dirname(fileURLToPath(import.meta.url)), 'resources', 'scripts', 'components', 'admin'),

            react: 'preact/compat',
            'react-dom': 'preact/compat',
            'react/jsx-runtime': 'preact/jsx-runtime',
            'react-dom/test-utils': 'preact/test-utils',
        },
    },

    test: {
        environment: 'happy-dom',
        include: ['resources/scripts/**/*.{spec,test}.{ts,tsx}'],
    },
});