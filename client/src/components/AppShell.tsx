import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';
import Toaster from './ui/Toaster';
import AuthModal from './AuthModal';
import BuyCreditsModal from './BuyCreditsModal';
import ReportModal from './ReportModal';
import FeedbackModal from './FeedbackModal';
import CookieBanner from './CookieBanner';
import { useStore } from '../store/useStore';

/**
 * Guscio dell'applicazione: barra laterale persistente + contenuto della rotta.
 *
 * Prima la navigazione era uno switch su una variabile di stato dentro App.tsx,
 * e il footer marketing veniva renderizzato anche sotto la chat (S3-5, S3-16).
 */
export default function AppShell() {
  const { isSidebarCollapsed, setMobileSidebarOpen, isCookieBannerOpen, cookieBannerHeight } = useStore();

  return (
    /**
     * `--yc-banner` è l'altezza riservata al banner dei cookie.
     *
     * Difetto trovato dal primo test end-to-end: il banner era `fixed` in fondo
     * alla finestra e copriva il pulsante di invio della chat. A differenza di
     * una notifica non spariva da solo, quindi chi apriva una conversazione
     * prima di decidere sui cookie semplicemente NON poteva scrivere — con il
     * pulsante perfettamente visibile e abilitato sotto al banner.
     *
     * Le pagine a scorrimento usano la variabile come spazio in fondo; la chat,
     * che ha un'altezza fissa pari alla finestra, la sottrae dalla propria.
     * L'altezza è misurata dal banner stesso, non stimata.
     */
    <div
      className="min-h-screen bg-bg text-ink"
      style={{ ['--yc-banner' as string]: isCookieBannerOpen ? `${cookieBannerHeight}px` : '0px' }}
    >
      <Sidebar />

      <div className={`flex min-h-screen flex-col pb-[length:var(--yc-banner)] transition-all duration-200 ${isSidebarCollapsed ? 'md:pl-16' : 'md:pl-64'}`}>
        {/* Barra superiore solo su mobile, per aprire il menu */}
        <header className="glass-panel sticky top-0 z-20 flex items-center gap-3 border-b px-4 py-3 md:hidden">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="Apri menu"
            className="btn-ghost rounded-lg p-1.5"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className="font-display text-sm font-bold">your-character</span>
        </header>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>

      <AuthModal />
      <BuyCreditsModal />
      <ReportModal />
      <FeedbackModal />
      <Toaster />
      <CookieBanner />
    </div>
  );
}
