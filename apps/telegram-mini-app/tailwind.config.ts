import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // ─── TON Brand Colors ─────────────────────────
        ton: {
          blue: '#4DB8FF',
          'blue-hover': '#3AACF7',
          'blue-soft': 'rgba(77, 184, 255, 0.12)',
          'blue-glow': 'rgba(77, 184, 255, 0.06)',
        },
        // ─── Semantic (mapped to Telegram CSS vars at runtime) ──
        surface: {
          primary: 'var(--tg-theme-bg-color, #FFFFFF)',
          secondary: 'var(--tg-theme-secondary-bg-color, #F7F8FA)',
          section: 'var(--tg-theme-section-bg-color, #FFFFFF)',
          header: 'var(--tg-theme-header-bg-color, #FFFFFF)',
        },
        text: {
          primary: 'var(--tg-theme-text-color, #0F1011)',
          secondary: 'var(--tg-theme-subtitle-text-color, #8E8E93)',
          hint: 'var(--tg-theme-hint-color, #999999)',
          section: 'var(--tg-theme-section-header-text-color, #6D6D72)',
          accent: 'var(--tg-theme-accent-text-color, #4DB8FF)',
          link: 'var(--tg-theme-link-color, #4DB8FF)',
          destructive: 'var(--tg-theme-destructive-text-color, #FF3B30)',
        },
        btn: {
          primary: 'var(--tg-theme-button-color, #4DB8FF)',
          'primary-text': 'var(--tg-theme-button-text-color, #FFFFFF)',
        },
        // ─── Status Colors ────────────────────────────
        status: {
          success: '#34C759',
          'success-soft': 'rgba(52, 199, 89, 0.12)',
          warning: '#FF9F0A',
          'warning-soft': 'rgba(255, 159, 10, 0.12)',
          danger: '#FF3B30',
          'danger-soft': 'rgba(255, 59, 48, 0.12)',
        },
      },
      fontFamily: {
        sans: [
          '"ABC Diatype"',
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"Segoe UI"',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        mono: [
          '"Suisse Intl Mono"',
          '"SF Mono"',
          'Menlo',
          'Monaco',
          '"Cascadia Code"',
          '"Fira Code"',
          'Consolas',
          'monospace',
        ],
      },
      borderRadius: {
        'tg': '16px',
        'tg-sm': '12px',
        'tg-xs': '8px',
      },
      spacing: {
        'tg-safe-top': 'var(--tg-viewport-stable-height, env(safe-area-inset-top, 0px))',
      },
      boxShadow: {
        'card': '0 1px 2px rgba(0, 0, 0, 0.04)',
        'card-hover': '0 2px 8px rgba(0, 0, 0, 0.06)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.35s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
