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
        sans: ['Manrope', 'system-ui', 'sans-serif'],
        display: ['Unbounded', 'Manrope', 'system-ui', 'sans-serif'],
      },
      borderRadius: { DEFAULT: '6px', lg: '10px' },
      maxWidth: { page: '1200px' },
      keyframes: {
        ladderIn: { from: { opacity: '0', transform: 'translateY(18px)' }, to: { opacity: '1', transform: 'none' } },
        marquee: { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } },
        floatY: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-8px)' } },
      },
    },
  },
  plugins: [],
} satisfies Config;
