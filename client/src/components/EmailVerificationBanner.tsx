import { MailWarning } from 'lucide-react';
import { useStore } from '../store/useStore';

/**
 * La striscia che ricorda di confermare l'indirizzo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Esiste perché il cancello della verifica sta sul SERVER, e senza questa
 * striscia l'utente lo scoprirebbe nel modo peggiore: scrivendo il primo
 * messaggio a un personaggio e ricevendo un rifiuto. Un requisito che si
 * manifesta solo quando lo si viola è un requisito nascosto.
 *
 * Perché è una striscia e non un modale che blocca: l'account esiste, la
 * sessione è aperta e il catalogo è visitabile. Chi è appena arrivato ha il
 * diritto di guardarsi intorno prima di andare a cercare un codice nella posta
 * — e chi non trova subito l'email non deve trovarsi chiuso fuori dal prodotto
 * che stava valutando.
 *
 * Non è chiudibile, di proposito. Un avviso che si può far sparire e che
 * riguarda una cosa ancora da fare diventa un avviso che sparisce e basta:
 * l'unico modo di toglierla è confermare, che è esattamente ciò che chiede.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EmailVerificationBanner() {
  const user = useStore((s) => s.user);
  const isAuthResolved = useStore((s) => s.isAuthResolved);
  const setAuthModalOpen = useStore((s) => s.setAuthModalOpen);

  // Finché la sessione non è risolta non si sa nulla: mostrare la striscia a
  // chi magari è già verificato sarebbe un rimprovero infondato per il tempo
  // di un caricamento.
  if (!isAuthResolved || !user) return null;
  if (user.emailVerified !== false) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warning/25 bg-warning/[0.08] px-4 py-2.5 text-center"
    >
      <MailWarning className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <span className="text-sm text-ink">
        Conferma il tuo indirizzo per scrivere ai personaggi.
      </span>
      <button
        type="button"
        onClick={() => setAuthModalOpen(true, 'verify')}
        className="text-sm font-semibold text-accent-glow underline underline-offset-2 transition-colors hover:text-ink"
      >
        Inserisci il codice
      </button>
    </div>
  );
}
