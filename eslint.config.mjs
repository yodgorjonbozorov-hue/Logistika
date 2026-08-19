// Umumiy ESLint konfiguratsiyasi (flat config). Workspace'lar o'z qoidalarini qo'shishi mumkin.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/dist-demo/**', '**/node_modules/**', '**/coverage/**', 'mobile/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // Repo-darajasidagi build skriptlari Node muhitida ishlaydi.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
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
