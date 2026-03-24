import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Script from 'next/script';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'TradeMind — DeFi Concierge',
  description: 'Autonomous DeFi assistant on TON blockchain',
  icons: {
    icon: '/icon.jpg',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps): ReactNode {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
        {children}
      </body>
    </html>
  );
}
