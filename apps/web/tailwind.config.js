/**
 * Tailwind reads its palette from the Nocturne tokens in
 * `src/shared/theme/nocturne.css` — the design system is the source of truth,
 * so no hex value is repeated here.
 */
const ramp = (role, steps) =>
  Object.fromEntries(steps.map((step) => [step, `var(--color-${role}-${step})`]));

const RAMP_STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        ink: 'var(--color-text)',
        divider: 'var(--color-divider)',
        accent: { DEFAULT: 'var(--color-accent)', ...ramp('accent', RAMP_STEPS) },
        neutral: ramp('neutral', RAMP_STEPS),
        positive: { DEFAULT: 'var(--color-positive)', text: 'var(--color-positive-text)' },
        warning: { DEFAULT: 'var(--color-warning)', text: 'var(--color-warning-text)' },
        danger: { DEFAULT: 'var(--color-danger)', text: 'var(--color-danger-text)' },
        info: { DEFAULT: 'var(--color-info)', text: 'var(--color-info-text)' },
      },
      fontFamily: {
        heading: 'var(--font-heading)',
        body: 'var(--font-body)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
    },
  },
  plugins: [],
};
