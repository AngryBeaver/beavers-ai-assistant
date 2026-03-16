const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
  },
});