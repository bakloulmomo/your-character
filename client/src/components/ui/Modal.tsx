import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Larghezza massima; 'lg' per i modali con più contenuto. */
  size?: 'md' | 'lg';
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Modale accessibile.
 *
 * I modali precedenti non avevano ruolo, non si chiudevano con Esc né con un
 * click sullo sfondo, non intrappolavano il focus e non lo restituivano
 * all'elemento di partenza: con la tastiera erano inutilizzabili (S3-23).
 */
export default function Modal({ open, onClose, title, children, size = 'md' }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== 'Tab' || !panel) return;

      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null
      );
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    /**
     * Scala dei livelli di sovrapposizione (dal basso):
     *   z-20  barra superiore su mobile
     *   z-30  velo della barra laterale
     *   z-40  barra laterale
     *   z-50  banner dei cookie
     *   z-[60] MODALI  ← qui
     *   z-[70] notifiche
     *
     * Il modale sta SOPRA il banner dei cookie. Con lo stesso livello vinceva
     * quello piu' in basso nel DOM, cioe' il banner: risultato, il banner
     * intercettava i click sui comandi del modale e il pulsante di conferma
     * dell'acquisto era inutilizzabile finche' non si rispondeva ai cookie.
     * E' lo stesso difetto gia' corretto per il campo di scrittura della chat,
     * che sui modali era rimasto.
     */
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`animate-slide-up my-8 w-full ${size === 'lg' ? 'max-w-2xl' : 'max-w-md'} rounded-2xl border border-line bg-bg-elevated shadow-2xl`}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Chiudi"
            className="btn-ghost rounded-lg p-1.5"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
