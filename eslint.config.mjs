// Umumiy ESLint konfiguratsiyasi (flat config). Workspace'lar o'z qoidalarini qo'shishi mumkin.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'mobile/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // Vercel Function entry'lari — CommonJS, Node global'lari bilan.
    files: ['apps/*/api/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable', __dirname: 'readonly' },
    },
    rules: {
      // CommonJS shim — bu yerda `require` aynan maqsadli ishlatiladi.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    rules: {
      // MUHIM QOIDA: bo'sh catch taqiqlanadi (CLAUDE.md — error handling)
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
);
