import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { useStore } from '../../store/useStore';

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info
};

const TONES = {
  success: 'border-success/40 text-success',
  error: 'border-danger/40 text-danger',
  info: 'border-sapphire/40 text-sapphire-glow'
};

/**
 * Notifiche globali. Prima l'unico feedback fuori dai modali era un `alert()`
 * del browser nell'export GDPR (S3-12).
 *
 * Posizione in alto a destra, non in basso (FASE E).
 *
 * Difetto trovato dal primo test end-to-end: in basso a destra il riquadro si
 * sovrapponeva al pulsante di invio della chat e, avendo `pointer-events-auto`,
 * ne intercettava i click. Per i cinque secondi di vita della notifica l'utente
 * *non poteva inviare messaggi* — e non c'era modo di capire perché, visto che
 * il pulsante restava perfettamente visibile e abilitato.
 *
 * È esattamente il genere di difetto che nessun test unitario può vedere:
 * entrambi i componenti funzionano, è il loro incontro sullo schermo a essere
 * rotto.
 */
export default function Toaster() {
  const { toasts, dismissToast } = useStore();
  if (toasts.length === 0) return null;

  return (
    <div
      // z-[70]: le notifiche stanno sopra i modali. Un avviso di errore
      // nascosto dietro la finestra che l'ha provocato non avvisa nessuno.
      className="pointer-events-none fixed right-4 top-4 z-[70] flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((toast) => {
        const Icon = ICONS[toast.kind];
        return (
          <div
            key={toast.id}
            /**
             * Il ruolo sta sulla singola notifica, non sul contenitore, e
             * dipende dal tono.
             *
             * Prima l'intero riquadro era un solo `role="status"` con
             * `aria-live="polite"`: un errore veniva quindi annunciato solo
             * quando lo screen reader finiva ciò che stava già leggendo — e
             * siccome la notifica sparisce da sola dopo cinque secondi, poteva
             * benissimo non essere annunciata affatto. «Il messaggio non è
             * stato inviato» non è un'informazione che può aspettare.
             */
            role={toast.kind === 'error' ? 'alert' : 'status'}
            aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
            className={`animate-slide-down glass-panel pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 shadow-xl ${TONES[toast.kind]}`}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="flex-1 text-sm text-ink">{toast.message}</p>
            <button
              onClick={() => dismissToast(toast.id)}
              aria-label="Chiudi notifica"
              className="btn-ghost rounded p-0.5"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
