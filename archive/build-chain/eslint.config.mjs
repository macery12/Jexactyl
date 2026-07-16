import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

// Flat config (ESLint 9/10). Replaces the legacy .eslintrc.js + .eslintignore.
export default tseslint.config(
    // Global ignores — replaces .eslintignore.
    {
        ignores: [
            'public/**',
            'resources/views/**',
            'babel.config.js',
            'tailwind.config.js',
            'webpack.config.js',
        ],
    },

    // Base recommended rule sets (equivalent to the old `extends`).
    js.configs.recommended,
    ...tseslint.configs.recommended,
    reactPlugin.configs.flat.recommended,
    reactPlugin.configs.flat['jsx-runtime'],

    // Project source.
    {
        files: ['resources/scripts/**/*.{ts,tsx}'],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                ecmaVersion: 6,
                ecmaFeatures: { jsx: true },
                project: './tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                ...globals.browser,
            },
        },
        settings: {
            react: {
                pragma: 'React',
                // Pinned explicitly (not 'detect') because eslint-plugin-react@7.37.5's
                // version-detection path calls the removed context.getFilename() API and
                // crashes under ESLint 10. Keep in sync with the installed react version.
                version: '18.2.0',
            },
            linkComponents: [
                { name: 'Link', linkAttribute: 'to' },
                { name: 'NavLink', linkAttribute: 'to' },
            ],
        },
        plugins: {
            // react-hooks is registered to preserve the prior toolchain. The legacy
            // .eslintrc.js enabled no react-hooks rules, so none are enabled here
            // either (the v7 `recommended-latest` set would introduce 17 new rules
            // across the codebase — out of scope for a dependency upgrade).
            'react-hooks': reactHooks,
            prettier: prettierPlugin,
        },
        rules: {
            eqeqeq: 'error',
            'prettier/prettier': ['error', {}, { usePrettierrc: true }],
            // TypeScript can infer this significantly better than eslint ever can.
            'react/prop-types': 0,
            'react/display-name': 0,
            'react/no-unknown-property': ['error', { ignore: ['css'] }],
            '@typescript-eslint/no-explicit-any': 0,
            '@typescript-eslint/no-non-null-assertion': 0,
            // Avoids spurious errors about React being used before it is defined.
            // @see https://github.com/typescript-eslint/typescript-eslint/blob/master/packages/eslint-plugin/docs/rules/no-use-before-define.md#how-to-use
            'no-use-before-define': 0,
            '@typescript-eslint/no-use-before-define': 'warn',
            // Allow the established `cond && fn()` / `cond ? a() : b()` short-circuit
            // statement pattern used throughout the codebase (rule is new in TS-eslint v8).
            '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description' }],
        },
    },

    // Must be last: disables stylistic rules that conflict with Prettier.
    prettierConfig,
);
