/**
 * TradeMind — Main Page
 *
 * Uses dynamic import with ssr: false to ensure TonConnect SDK
 * only runs in the browser (it requires window/document).
 */

import dynamic from 'next/dynamic';

const AppContent = dynamic(
  () => import('../components/AppContent'),
  { ssr: false },
);

export default function HomePage() {
  return <AppContent />;
}
