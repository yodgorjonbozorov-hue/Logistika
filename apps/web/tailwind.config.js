import palette from './src/shared/ui/palette.json' with { type: 'json' };

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /**
       * Brand palette — docs/TZ.md §11 — in one file both this config and the
       * contrast test read (L-10, TASK-5.5).
       *
       * The `-text` variants are the same colours darkened until they reach
       * WCAG AA as *text on white*. The brand set is built for a dark
       * interface and passes there (accent on navy is 7.0:1); on white the
       * accent was 2.03:1, below even the 3.0 allowed for large text. The
       * originals still fill backgrounds and paint dark mode.
       */
      colors: palette,
    },
  },
  plugins: [],
};
