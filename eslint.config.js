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
        fetch: 'readonly', // Node 18+ global (photoProof download path)
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        global: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
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
