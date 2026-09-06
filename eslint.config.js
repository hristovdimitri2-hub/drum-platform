/**
 * ESLint flat config (B-этап 4: lint чист като CI gate).
 * Minimal, pragmatic rules — no style nitpicking.
 */

export default [
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        __dirname: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        global: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-constant-condition': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'eqeqeq': ['error', 'smart'],
    },
  },
  {
    ignores: ['node_modules/**', 'coverage/**', 'data/**', 'reports/**'],
  },
];
