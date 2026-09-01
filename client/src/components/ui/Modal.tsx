import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Riga di contesto sotto il titolo. Opzionale: senza, l'intestazione resta compatta. */
  description?: ReactNode;
  children: ReactNode;
  /** Larghezza massima; 'lg' per i modali con più contenuto. */
  size?: 'md' | 'lg';
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Un elemento è raggiungibile davvero?
 *
 * La versione precedente filtrava con `el.offsetParent !== null`. In un browser
 * funziona; in jsdom `offsetParent` è SEMPRE null perché il layout non viene
 * calcolato — quindi la lista dei focalizzabili risultava vuota e la trappola
 * del fuoco non faceva nulla. Non era un difetto visibile in produzione, ma
 * significava che nessun test avrebbe MAI potuto verificare la trappola: la
 * parte più delicata del componente era, di fatto, non testabile.
 *
 * `checkVisibility()` è l'API giusta e non dipende da `offsetParent`; dove non
 * esiste (jsdom) si accetta l'elemento, perché lì non c'è nulla di nascosto da
 * scartare.
 */
type WithVisibility = HTMLElement & { checkVisibility?: () => boolean };

const isReachable = (el: HTMLElement) => {
  if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
  if (el.closest('[hidden]')) return false;
  const check = (el as WithVisibility).checkVisibility;
  return typeof check === 'function' ? check.call(el) : true;
};

/**
 * Modale accessibile.
 *
 * ─── Il difetto che questo file correggeva già, e quello che ci aveva messo ───
 *
 * I modali originali non avevano ruolo, non si chiudevano con Esc né con un
 * click sullo sfondo, non intrappolavano il fuoco e non lo restituivano
 * all'elemento di partenza: con la tastiera erano inutilizzabili (S3-23).
 *
 * La correzione di allora però metteva TUTTO in un solo effetto, con `onClose`
 * fra le dipendenze:
 *
 *     useEffect(() => { …fuoco iniziale…; …listener…;
 *                       return () => previouslyFocused.current?.focus(); },
 *               [open, onClose]);
 *
 * `onClose` è quasi sempre una lambda dichiarata nel render del chiamante —
 * `onClose={() => setDeleteOpen(false)}` — quindi cambia identità a OGNI render
 * del genitore. Ogni carattere digitato in un campo del modale faceva dunque:
 * ri-render del genitore → nuova identità di `onClose` → smontaggio
 * dell'effetto (la cui pulizia sposta il fuoco) → rimontaggio (che lo sposta
 * di nuovo, sul primo focalizzabile del pannello, cioè il pulsante «X»).
 *
 * Sintomo: al primo tasto premuto il campo perde il fuoco e il cursore salta
 * sulla X di chiusura. Un modulo di registrazione impossibile da compilare.
 *
 * ─── La struttura corretta ───
 *
 * Le due responsabilità sono separate, e nessuna delle due dipende
 * dall'identità di una funzione:
 *
 *   1. CICLO DI VITA DELL'APERTURA — dipende solo da `open`. Salva l'elemento
 *      di partenza, dà il fuoco al primo campo del CORPO (non alla X), blocca
 *      lo scorrimento, e alla chiusura restituisce il fuoco.
 *
 *   2. TASTIERA — montato una volta, legge `onClose` da una ref sempre
 *      aggiornata. Così il listener non si ri-sottoscrive mai.
 *
 * Il principio: un componente di base non deve pretendere che i suoi chiamanti
 * memoizzino le callback. Sei dei sette consumatori di questo modale passano
 * una lambda inline, ed è legittimo che lo facciano.
 */
export default function Modal({ open, onClose, title, description, children, size = 'md' }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  /**
   * `onClose` sempre aggiornato, senza mai comparire in una lista di dipendenze.
   * È il pattern `useEvent`: il valore cambia, l'identità del lettore no.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const close = useCallback(() => onCloseRef.current(), []);

  const focusables = useCallback(
    () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(isReachable),
    []
  );

  // ── 1. Ciclo di vita dell'apertura ────────────────────────────────────────
  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    /**
     * Il fuoco iniziale va nel CORPO del modale, non nell'intestazione.
     *
     * `panel.querySelector(FOCUSABLE)` prendeva il primo focalizzabile
     * dell'intero pannello, e nell'ordine del DOM è il pulsante di chiusura:
     * aprire un modulo e trovarsi sulla «X» invita ad annullare proprio mentre
     * si voleva cominciare. Un chiamante può indicare il punto esatto con
     * `data-autofocus`; altrimenti si prende il primo campo del corpo.
     */
    const explicit = bodyRef.current?.querySelector<HTMLElement>('[data-autofocus]');
    const firstInBody = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).find(isReachable);
    (explicit ?? firstInBody ?? panelRef.current)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      // Solo se l'elemento è ancora nel documento: dopo un'eliminazione la
      // riga che aveva aperto il modale può non esistere più, e `focus()` su un
      // nodo staccato manda il fuoco sul <body>, cioè in nessun posto.
      const origin = previouslyFocused.current;
      if (origin && document.contains(origin)) origin.focus();
    };
  }, [open]);

  // ── 2. Tastiera: Esc e trappola del fuoco ─────────────────────────────────
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }

      if (e.key !== 'Tab') return;

      const items = focusables();
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // Il fuoco può essere finito fuori dal pannello (click sullo sfondo,
      // barra degli strumenti del browser): in quel caso lo si riporta dentro
      // invece di lasciarlo vagare per la pagina sottostante.
      if (!panelRef.current?.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close, focusables]);

  /**
   * Chiusura con un click sullo sfondo — ma solo se il gesto è COMINCIATO
   * sullo sfondo.
   *
   * Prima bastava un `onClick` sull'overlay. Chi seleziona il testo di un
   * campo trascinando e rilascia il mouse oltre il bordo del pannello produce
   * un `click` il cui bersaglio è l'antenato comune, cioè l'overlay: il modale
   * si chiudeva e il modulo compilato spariva. È un gesto ordinario, non un
   * caso limite.
   */
  const pressStartedOnOverlay = useRef(false);

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
     */
    <div
      data-testid="modal-overlay"
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-md sm:items-center"
      onMouseDown={(e) => {
        pressStartedOnOverlay.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressStartedOnOverlay.current) close();
        pressStartedOnOverlay.current = false;
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`animate-slide-up my-auto w-full outline-none ${size === 'lg' ? 'max-w-2xl' : 'max-w-[26.5rem]'}
                    rounded-xl border border-line bg-bg-elevated
                    shadow-[0_32px_80px_-16px_rgba(0,0,0,0.85)] ring-1 ring-white/[0.06]`}
      >
        <div className="flex items-start justify-between gap-4 px-6 pb-5 pt-6">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-xl font-semibold leading-tight tracking-[-0.02em] text-ink">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Chiudi"
            className="btn-ghost -mr-1.5 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl"
          >
            <X className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </div>
        <div ref={bodyRef} className="px-6 pb-6">
          {children}
        </div>
      </div>
    </div>
  );
}
