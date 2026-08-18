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
    // Yuklama testi (TASK-4.6): `seed.mjs` — Node skripti, `scenarios/*` esa k6
    // ichida ishlaydi va uning o'z global'lari bor. Ular ham kod, shuning uchun
    // lint'dan chiqarilmaydi — faqat global'lari e'lon qilinadi.
    files: ['load-test/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        __ENV: 'readonly',
        __VU: 'readonly',
        __ITER: 'readonly',
      },
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
