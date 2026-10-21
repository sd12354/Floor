import type { Config } from 'tailwindcss';

// Colours come from CSS variables (see src/index.css) so the same classes work in light and dark.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: v('paper'),
        surface: v('surface'),
        sunken: v('sunken'),
        ink: v('ink'),
        muted: v('muted'),
        faint: v('faint'),
        rule: v('rule'),
        accent: v('accent'),
        'accent-ink': v('accent-ink'),
        floor: v('floor'),
        amber: v('amber'),
        green: v('green'),
      },
      fontFamily: {
        sans: ['"Instrument Sans"', 'system-ui', 'sans-serif'],
        display: ['"Young Serif"', 'Georgia', 'serif'],
      },
      borderRadius: { DEFAULT: '6px', lg: '10px' },
      maxWidth: { page: '1200px' },
    },
  },
  plugins: [],
} satisfies Config;
