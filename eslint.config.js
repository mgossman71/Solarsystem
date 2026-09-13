import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'coverage/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
    },
    rules: {
      // tsc --noEmit with noUnusedLocals/noUnusedParameters is the stricter
      // check (it also catches unused import members); keep ESLint quiet here.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    // Node-side scripts (the lighting math test, texture tooling).
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);