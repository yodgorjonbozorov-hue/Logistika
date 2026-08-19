/**
 * Logixa AI design system — Tailwind reads every value from the CSS custom
 * properties declared in `src/index.css`, so light/dark are one token swap and
 * no component hard-codes a color.
 */
const withAlpha = (variable) => `rgb(var(${variable}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: withAlpha('--c-brand-primary'),
          primary: withAlpha('--c-brand-primary'),
          secondary: withAlpha('--c-brand-secondary'),
          accent: withAlpha('--c-brand-accent'),
          deep: withAlpha('--c-brand-deep'),
          soft: withAlpha('--c-brand-soft'),
        },
        background: withAlpha('--c-background'),
        surface: {
          DEFAULT: withAlpha('--c-surface'),
          raised: withAlpha('--c-surface-raised'),
          sunken: withAlpha('--c-surface-sunken'),
          inverse: withAlpha('--c-inverse-surface'),
        },
        ink: {
          DEFAULT: withAlpha('--c-text-primary'),
          secondary: withAlpha('--c-text-secondary'),
          tertiary: withAlpha('--c-text-tertiary'),
          inverse: withAlpha('--c-text-inverse'),
        },
        line: {
          DEFAULT: withAlpha('--c-border'),
          strong: withAlpha('--c-border-strong'),
          divider: withAlpha('--c-divider'),
        },
        success: {
          DEFAULT: withAlpha('--c-success'),
          surface: withAlpha('--c-success-surface'),
        },
        warning: {
          DEFAULT: withAlpha('--c-warning'),
          surface: withAlpha('--c-warning-surface'),
        },
        danger: {
          DEFAULT: withAlpha('--c-danger'),
          surface: withAlpha('--c-danger-surface'),
        },
        info: {
          DEFAULT: withAlpha('--c-info'),
          surface: withAlpha('--c-info-surface'),
        },
        // Legacy aliases kept on-brand so no surface can drift off the palette.
        navy: withAlpha('--c-brand-secondary'),
        accent: withAlpha('--c-brand-primary'),
        muted: withAlpha('--c-text-tertiary'),
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Display',
          'SF Pro Text',
          'Inter',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'sans-serif',
        ],
        mono: ['SF Mono', 'ui-monospace', 'IBM Plex Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        // iOS type ramp — no cartoon-sized headings.
        caption: ['11.5px', { lineHeight: '1.35', letterSpacing: '0.01em' }],
        footnote: ['12.5px', { lineHeight: '1.4' }],
        subhead: ['13.5px', { lineHeight: '1.45' }],
        body: ['15px', { lineHeight: '1.47' }],
        headline: ['17px', { lineHeight: '1.4', letterSpacing: '-0.01em' }],
        title3: ['20px', { lineHeight: '1.3', letterSpacing: '-0.015em' }],
        title2: ['24px', { lineHeight: '1.25', letterSpacing: '-0.02em' }],
        title1: ['30px', { lineHeight: '1.2', letterSpacing: '-0.022em' }],
        display: ['42px', { lineHeight: '1.1', letterSpacing: '-0.025em' }],
      },
      letterSpacing: {
        kicker: '0.2em',
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        pill: '100px',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      transitionTimingFunction: {
        ios: 'var(--ease-ios)',
      },
      keyframes: {
        'lx-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        'lx-fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'lx-rise': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.985)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'lx-sheet-up': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'lx-shimmer': {
          from: { backgroundPosition: '200% 0' },
          to: { backgroundPosition: '-200% 0' },
        },
        'lx-spin': {
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'lx-pulse': 'lx-pulse 2s ease-in-out infinite',
        'lx-fade-in': 'lx-fade-in var(--duration-base) var(--ease-ios) both',
        'lx-rise': 'lx-rise var(--duration-base) var(--ease-ios) both',
        'lx-sheet-up': 'lx-sheet-up var(--duration-base) var(--ease-ios) both',
        'lx-shimmer': 'lx-shimmer 1.6s linear infinite',
        'lx-spin': 'lx-spin 0.7s linear infinite',
      },
    },
  },
  plugins: [],
};
