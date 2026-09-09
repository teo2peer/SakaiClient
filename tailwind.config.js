/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Values live in CSS variables so the palette picker in Settings can
        // swap them at runtime. Defaults are declared in `src/global.css`.
        ink: 'rgb(var(--color-ink) / <alpha-value>)',
        pine: 'rgb(var(--color-pine) / <alpha-value>)',
        'pine-contrast': 'rgb(var(--color-pine-contrast) / <alpha-value>)',
        mint: 'rgb(var(--color-mint) / <alpha-value>)',
        paper: 'rgb(var(--color-paper) / <alpha-value>)',
        line: 'rgb(var(--color-line) / <alpha-value>)',
        ember: 'rgb(var(--color-ember) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
