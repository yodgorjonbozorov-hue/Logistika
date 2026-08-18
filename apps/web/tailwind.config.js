/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Brand palette — docs/TZ.md §11. Semantic surface/ink tokens resolve
      // through CSS variables so light and dark stay in sync (src/index.css).
      colors: {
        navy: '#1B2A4A',
        accent: '#F5A623',
        success: '#2FAE6A',
        danger: '#E14B4B',
        muted: 'rgb(var(--ink-2) / <alpha-value>)',
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-2': 'rgb(var(--ink-2) / <alpha-value>)',
      },
      boxShadow: {
        card: '0 1px 2px rgb(15 23 42 / 0.04), 0 1px 3px rgb(15 23 42 / 0.06)',
        pop: '0 10px 30px -10px rgb(15 23 42 / 0.35)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { transform: 'translateY(8px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-up': 'slide-up 180ms ease-out',
      },
    },
  },
  plugins: [],
};
