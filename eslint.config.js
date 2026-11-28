import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'apps/backend/prisma/migrations/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['**/*.test.js', '**/test/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
  {
    files: ['apps/frontend/src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: '19.0' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/prop-types': 'off',
      // Logical CSS only (RTL support): physical margin/padding/position utilities are not allowed.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'Literal[value=/(^|\\s)-?(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r)-|(^|\\s)text-(left|right)(\\s|$)/]',
          message: 'Use logical utilities (ms-/me-/ps-/pe-/start-/end-/text-start/text-end) for RTL support.',
        },
      ],
      'react/no-danger': 'error',
    },
  },
  {
    // Desktop app status window: browser globals only (sandboxed, no Node.js); no HTML injection.
    files: ['apps/agent/src/renderer/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Build DOM nodes; never inject HTML.' },
        { property: 'outerHTML', message: 'Build DOM nodes; never inject HTML.' },
      ],
    },
  },
  {
    files: ['apps/agent/src/preload/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    files: ['apps/frontend/src/**/*.test.{js,jsx}', 'apps/frontend/test/**/*.{js,jsx}'],
    plugins: { react },
    languageOptions: {
      globals: { ...globals.browser, ...globals.jest, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: { ...react.configs['jsx-runtime'].rules, 'react/jsx-uses-vars': 'error' },
  },
];
