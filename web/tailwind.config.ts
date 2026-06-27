import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans Variable"', '"Plus Jakarta Sans"', 'sans-serif'],
      },
      colors: {
        verde: {
          50:  '#E8F5F2',
          100: '#D1EBE4',
          200: '#A3D7C9',
          300: '#75C3AE',
          400: '#4FC4A8',
          500: '#1DA882',
          600: '#128F7A',
          700: '#0D6E5E',
          800: '#095048',
          900: '#063530',
        },
        cinza: {
          50:  '#FAFCFB',
          100: '#F0F4F3',
          200: '#E1E8E7',
          300: '#B8C3C2',
          400: '#8E9D9C',
          500: '#6B7575',
          600: '#4A5352',
          700: '#3D4645',
          800: '#2B3332',
          900: '#1A1F1E',
        },
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'card-md': '0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.04)',
      },
    },
  },
  plugins: [],
} satisfies Config
