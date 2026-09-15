import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import AuthModal from './AuthModal';
import Toaster from './ui/Toaster';
import CookieBanner from './CookieBanner';
import { Button, ButtonLink } from './ui/Button';

/**
 * Il guscio delle pagine PUBBLICHE: presentazione, prezzi, domande, contatti.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Fino a ieri `/` era il catalogo. Chi arrivava senza sapere che cos'è
 * `your-character` si trovava davanti una griglia di volti sconosciuti, una
 * barra laterale con la propria cronologia vuota, e nessuna frase che dicesse
 * di che cosa si trattasse. È il difetto più costoso che può avere un
 * prodotto: non perde le persone perché non è convincente, le perde perché non
 * ha mai avuto occasione di provarci.
 *
 * Il catalogo si è spostato su `/discover` — dov'era già logico che stesse — e
 * `/` è la porta d'ingresso.
 *
 * `AuthModal` è montato QUI e non solo in `AppShell`: lo store è condiviso,
 * quindi «Registrati» funziona già da queste pagine, ma il componente che lo
 * disegna vive dentro il guscio dell'applicazione. Senza questa riga il
 * pulsante avrebbe cambiato lo stato e non avrebbe aperto niente — un guasto
 * che non lascia errori e si nota solo provando.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const VOCI = [
  { to: '/discover', label: 'Esplora' },
  { to: '/prezzi', label: 'Prezzi' },
  { to: '/faq', label: 'Domande' },
  { to: '/contatti', label: 'Contatti' }
];

export default function MarketingLayout({ children }: { children: ReactNode }) {
  const { user, setAuthModalOpen } = useStore();
  const [menuAperto, setMenuAperto] = useState(false);

  return (
    <div className="min-h-screen bg-bg text-ink">
      {/* Lo stesso salto al contenuto delle pagine dell'applicazione: la prima
          tabulazione deve poter scavalcare l'intestazione. */}
      <a
        href="#contenuto"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-md
                   focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink"
      >
        Vai al contenuto
      </a>

      <header className="glass-panel sticky top-0 z-50 border-b border-line">
        <div className="mx-auto flex max-w-[76rem] items-center justify-between gap-4 px-5 py-3 md:px-8">
          <Link to="/" className="flex items-center gap-2.5 font-display text-sm font-bold text-ink">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            your-character
          </Link>

          <nav aria-label="Sezioni del sito" className="hidden items-center gap-1 md:flex">
            {VOCI.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm transition-colors ${
                    isActive ? 'text-ink' : 'text-ink-muted hover:text-ink'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {user ? (
              <ButtonLink to="/discover" variant="primary" size="sm">
                Vai all'app
              </ButtonLink>
            ) : (
              <>
                <Button size="sm" className="hidden sm:inline-flex" onClick={() => setAuthModalOpen(true, 'login')}>
                  Accedi
                </Button>
                <Button size="sm" variant="primary" onClick={() => setAuthModalOpen(true, 'register')}>
                  Registrati
                </Button>
              </>
            )}
            <button
              onClick={() => setMenuAperto((v) => !v)}
              aria-label={menuAperto ? 'Chiudi menu' : 'Apri menu'}
              aria-expanded={menuAperto}
              className="btn-ghost rounded-md p-1.5 md:hidden"
            >
              {menuAperto ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {menuAperto && (
          <nav aria-label="Sezioni del sito" className="border-t border-line px-5 py-2 md:hidden">
            {VOCI.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMenuAperto(false)}
                className="block rounded-md px-2 py-2.5 text-sm text-ink-muted hover:text-ink"
              >
                {label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main id="contenuto" tabIndex={-1} className="outline-none">
        {children}
      </main>

      <footer className="mt-24 border-t border-line">
        <div className="mx-auto max-w-[76rem] px-5 py-12 md:px-8">
          <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
            <div>
              <p className="flex items-center gap-2.5 font-display text-sm font-bold text-ink">
                <img src="/favicon.svg" alt="" className="h-6 w-6" />
                your-character
              </p>
              {/**
                * L'obbligo dell'AI Act (art. 50), in vigore dal 2 agosto 2026:
                * va dichiarato in modo esplicito che si conversa con un sistema
                * automatico. Nei termini c'era già; qui è in una pagina che
                * qualcuno legge davvero.
                */}
              <p className="mt-3 max-w-sm text-xs leading-relaxed text-ink-dim">
                I personaggi sono generati da un sistema di intelligenza artificiale.
                Non sono persone, e le loro risposte non sono consigli professionali.
              </p>
            </div>

            <nav aria-label="Collegamenti legali" className="flex flex-col gap-2 text-xs text-ink-muted">
              <Link to="/terms" className="hover:text-ink">Termini di servizio</Link>
              <Link to="/privacy" className="hover:text-ink">Informativa sulla privacy</Link>
              <Link to="/cookie-policy" className="hover:text-ink">Cookie</Link>
              <Link to="/contatti" className="hover:text-ink">Contatti</Link>
            </nav>
          </div>
        </div>
      </footer>

      {/* Vedi il commento in testa: senza questi, i comandi di questa pagina
          cambierebbero lo stato senza disegnare nulla. */}
      <AuthModal />
      <Toaster />
      <CookieBanner />
    </div>
  );
}
