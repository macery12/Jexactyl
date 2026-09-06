import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
    { ignores: ['dist/', 'src/paraglide/', 'src/extensions/packages/'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    reactHooks.configs.flat.recommended,
    {
        files: ['**/*.{cjs,mjs,js}'],
        languageOptions: {
            globals: globals.node,
        },
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            globals: globals.browser,
        },
        rules: {
            // tsc -b (strict) already runs in the build; lint focuses on correctness
            // rules the compiler can't see, not on style churn across the port.
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            // React Compiler preview rules (new in react-hooks v7): advisory for
            // now — promoting them to errors is a refactor to schedule, not a gate.
            'react-hooks/set-state-in-effect': 'warn',
            'react-hooks/static-components': 'warn',
            'react-hooks/refs': 'warn',
            'react-hooks/immutability': 'warn',
            'react-hooks/incompatible-library': 'warn',
            'react-hooks/use-memo': 'warn',
        },
    },
);
