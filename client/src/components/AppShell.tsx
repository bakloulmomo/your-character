import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';
import ConfirmDialog from './ui/ConfirmDialog';
import EmailVerificationBanner from './EmailVerificationBanner';
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
      {/**
        * Salto diretto al contenuto.
        *
        * La barra laterale contiene, nell'ordine: logo, «Crea», campo di
        * ricerca, voci di navigazione e POI l'intera cronologia delle
        * conversazioni — una voce per chat, con un pulsante azioni ciascuna.
        * Chi naviga da tastiera doveva attraversarli tutti per raggiungere la
        * pagina, a ogni cambio di pagina: con venti conversazioni aperte sono
        * oltre quaranta tabulazioni prima di poter leggere qualcosa.
        *
        * Invisibile finché non riceve il focus, che è esattamente il momento in
        * cui serve.
        */}
      <a
        href="#contenuto"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink"
      >
        Vai al contenuto
      </a>

      <Sidebar />

      <div className={`flex min-h-screen flex-col pb-[var(--yc-banner)] transition-all duration-200 ${isSidebarCollapsed ? 'md:pl-16' : 'md:pl-64'}`}>
        {/* Barra superiore solo su mobile, per aprire il menu */}
        {/* `h-14` non e' decorativo: e' il valore di `--yc-topbar` in index.css,
            che la chat sottrae dalla propria altezza. Fissarlo qui e' cio' che
            rende quella sottrazione esatta invece che stimata. */}
        <header className="glass-panel sticky top-0 z-20 flex h-14 items-center gap-3 border-b px-4 md:hidden">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="Apri menu"
            className="btn-ghost rounded-lg p-1.5"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className="font-display text-sm font-bold">your-character</span>
        </header>

        {/* Sopra il contenuto e sotto la barra: si vede su ogni pagina senza
            coprire nulla, e scorre via leggendo invece di restare appiccicata. */}
        <EmailVerificationBanner />

        {/* `tabIndex={-1}` rende il contenitore un bersaglio valido per il
            salto: senza, il focus resterebbe sul link e la tabulazione
            successiva ripartirebbe dalla barra laterale. */}
        <main id="contenuto" tabIndex={-1} className="flex-1 outline-none">
          <Outlet />
        </main>
      </div>

      <AuthModal />
      <BuyCreditsModal />
      <ReportModal />
      <FeedbackModal />
      {/* Sopra gli altri modali nella scala dei livelli: una conferma può
          essere richiesta DA un modale — eliminare un personaggio dalla sua
          scheda, per dire — e deve comparire davanti a chi l'ha chiesta. */}
      <ConfirmDialog />
      <Toaster />
      <CookieBanner />
    </div>
  );
}
