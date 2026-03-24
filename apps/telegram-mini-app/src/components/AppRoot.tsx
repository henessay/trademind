/**
 * AppRoot — Root Theme Wrapper
 *
 * Responsibilities:
 * 1. Detects Telegram WebApp environment and syncs theme
 * 2. Applies `data-theme="dark"` when Telegram is in dark mode
 * 3. Calls `WebApp.ready()` to signal Telegram the app is loaded
 * 4. Calls `WebApp.expand()` for full-screen Mini App experience
 * 5. Wraps children in the airy layout container
 *
 * Theme cascade:
 *   Telegram injects CSS vars → Tailwind reads them → Components render
 *   If no Telegram → fallback vars from globals.css (light theme)
 *
 * Design: Generous padding (px-5 py-6), max-width container,
 * no heavy shadows, breathing room between sections.
 */

'use client';

import { useEffect, useState, type ReactNode } from 'react';

interface AppRootProps {
  readonly children: ReactNode;
}

/** Telegram WebApp global (injected by telegram-web-app.js script) */
interface TelegramWebApp {
  readonly ready: () => void;
  readonly expand: () => void;
  readonly close: () => void;
  readonly colorScheme: 'light' | 'dark';
  readonly themeParams: Record<string, string>;
  readonly isExpanded: boolean;
  readonly viewportHeight: number;
  readonly viewportStableHeight: number;
  readonly headerColor: string;
  readonly backgroundColor: string;
  readonly setHeaderColor: (color: 'bg_color' | 'secondary_bg_color' | string) => void;
  readonly setBackgroundColor: (color: 'bg_color' | 'secondary_bg_color' | string) => void;
  readonly onEvent: (event: string, callback: () => void) => void;
  readonly offEvent: (event: string, callback: () => void) => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export function AppRoot({ children }: AppRootProps): ReactNode {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const webapp = window.Telegram?.WebApp;

    if (webapp !== undefined) {
      // ── Inside Telegram ──
      // Signal that the app is ready (hides the loading indicator)
      webapp.ready();

      // Expand to full screen
      if (!webapp.isExpanded) {
        webapp.expand();
      }

      // Sync theme from Telegram
      setTheme(webapp.colorScheme);

      // Match header/background to Telegram theme
      webapp.setHeaderColor('bg_color');
      webapp.setBackgroundColor('bg_color');

      // Listen for theme changes (user toggles dark mode)
      const handleThemeChange = (): void => {
        if (webapp !== undefined) {
          setTheme(webapp.colorScheme);
        }
      };
      webapp.onEvent('themeChanged', handleThemeChange);

      setReady(true);

      return () => {
        webapp.offEvent('themeChanged', handleThemeChange);
      };
    } else {
      // ── Outside Telegram (browser dev) ──
      // Detect system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
      setTheme(prefersDark.matches ? 'dark' : 'light');

      const handleChange = (e: MediaQueryListEvent): void => {
        setTheme(e.matches ? 'dark' : 'light');
      };
      prefersDark.addEventListener('change', handleChange);

      setReady(true);

      return () => {
        prefersDark.removeEventListener('change', handleChange);
      };
    }
  }, []);

  return (
    <div
      data-theme={theme}
      className={`
        min-h-screen min-h-dvh
        bg-surface-primary text-text-primary
        transition-colors duration-200
        ${ready ? 'animate-fade-in' : 'opacity-0'}
      `}
    >
      {/* Max-width container with generous padding */}
      <div className="mx-auto max-w-lg px-5 py-6 pb-10">
        {children}
      </div>
    </div>
  );
}
