const js = require('@eslint/js');
const globals = require('globals');
const reactHooks = require('eslint-plugin-react-hooks');

module.exports = [
  { ignores: ['dist/**', 'node_modules/**', 'data/**', 'uploads/**'] },
  js.configs.recommended,
  {
    files: ['server.js', 'server.test.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node, describe: 'readonly', it: 'readonly', expect: 'readonly', afterAll: 'readonly' }
    },
    rules: { 'no-unused-vars': 'off' }
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021 }
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
];
