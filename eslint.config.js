import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/** One set of rules for the server, the shared code and the app. Type-aware rules catch forgotten awaits and unhandled promises. */
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'archive', 'data', '*.zip', 'public', 'eslint.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      // Route handlers go through wrap() and event handlers catch their own errors, so "an async function where a callback was expected" is by design.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false, arguments: false } }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The newer rules are written for the React Compiler. They flag the "latest value in a ref" and "load on mount" patterns this app uses on purpose: shown, not blocking.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
  {
    // Express gives request bodies the type `any`; every route reads them through text(), isGid() and friends, which check what they use.
    files: ['server/routes/**/*.ts', 'server/passkeys.ts', 'server/auth.ts', 'server/whatsapp.ts', 'server/feed.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  {
    // The feed parsers read documents whose shape belongs to other people; each field is checked as it is used.
    files: ['server/news/parse.ts', 'server/gcal.ts', 'server/livecal.ts', 'server/asana.ts', 'server/anthropic-usage.ts', 'server/anthropic-limits.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    files: ['server/**/*.ts', 'shared/**/*.ts', 'vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Tests mock freely; strict typing of mocks adds noise, not safety.
    files: ['**/*.test.ts', 'server/security/helpers.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
);
