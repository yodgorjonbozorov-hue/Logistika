/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Brand palette — docs/TZ.md §11
      colors: {
        navy: '#1B2A4A',
        accent: '#F5A623',
        success: '#2FAE6A',
        danger: '#E14B4B',
        muted: '#8A94A6',
      },
    },
  },
  plugins: [],
};
