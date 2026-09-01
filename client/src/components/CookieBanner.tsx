import { useEffect, useRef, useState } from 'react';
import { Cookie } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CONSENT_VERSION, needsDecision, setConsent } from '../lib/consent';
import api from '../services/api';
import { useStore } from '../store/useStore';

/**
 * Informativa sui cookie (FASE D — S2-6).
 *
 * Tre differenze rispetto a prima:
 *  · rifiutare costa un click esattamente come accettare, e non esiste una "X"
 *    che valga come consenso implicito;
 *  · la scelta governa qualcosa di reale (il caricamento anticipato di
 *    Stripe.js) invece di essere una stringa che nessuno legge;
 *  · viene registrata anche sull'account, perché il consenso va dimostrato e
 *    deve sopravvivere al cambio di dispositivo.
 */
export default function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const features = useStore((s) => s.features);
  const user = useStore((s) => s.user);
  const patchUser = useStore((s) => s.patchUser);
  const setCookieBanner = useStore((s) => s.setCookieBanner);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (needsDecision()) {
      const timer = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, []);

  /**
   * Comunica al guscio quanto spazio riservare, misurandolo davvero.
   *
   * Una costante scritta a mano sarebbe sbagliata appena cambia la lunghezza del
   * testo o la larghezza della finestra — e sbagliata di dieci pixel significa
   * lasciare coperto proprio il pulsante che si voleva liberare.
   */
  useEffect(() => {
    const el = panelRef.current;
    if (!visible || !el) return undefined;

    // 16px è lo scostamento `bottom-4` del riquadro dal bordo della finestra.
    const measure = () => setCookieBanner(true, el.getBoundingClientRect().height + 16);
    measure();

    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible, setCookieBanner]);

  const decide = async (functional: boolean) => {
    setConsent(functional);
    setVisible(false);
    setCookieBanner(false);

    if (!user) return;
    try {
      const payload = { functional, version: CONSENT_VERSION };
      await api.patch('/users/me/preferences', { cookieConsent: payload });
      patchUser({ cookieConsent: { ...payload, updatedAt: new Date().toISOString() } });
    } catch {
      // La scelta resta valida localmente: un errore di rete non deve
      // trasformarsi in un banner che si ripresenta all'infinito.
    }
  };

  if (!visible) return null;

  /**
   * Durante la beta i pagamenti sono spenti, quindi Stripe.js non viene MAI
   * caricato e non c'e' alcuno script di terze parti su cui esprimersi.
   * Restano solo i cookie tecnici, che sono strettamente necessari e per i
   * quali la normativa richiede informazione, non consenso.
   *
   * Chiedere di scegliere fra due opzioni identiche sarebbe teatro: una
   * domanda finta su una cosa che non accade. Qui si informa e basta — e
   * l'avviso e' molto piu' corto, il che risolve anche il secondo difetto:
   * un riquadro alto quasi trecento pixel costringeva il guscio a riservare
   * altrettanto spazio a piena larghezza, lasciando un vuoto sotto la
   * conversazione per una scheda che sta in un angolo.
   */
  if (!features.payments) {
    return (
      <div
        className="fixed bottom-4 left-4 right-4 z-50 max-w-md md:left-auto md:right-4"
        role="region"
        aria-label="Informativa cookie"
      >
        <div ref={panelRef} className="glass-panel animate-slide-up flex items-center gap-3 rounded-xl border p-3 shadow-2xl">
          <Cookie className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <p className="flex-1 text-xs leading-relaxed text-ink-muted">
            Usiamo solo cookie tecnici, per tenere aperta la sessione.{' '}
            <Link to="/privacy" className="text-accent-glow underline">Dettagli</Link>
          </p>
          <button
            onClick={() => decide(false)}
            className="btn-secondary shrink-0 rounded-xl px-3 py-1.5 text-xs"
          >
            Ho capito
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-50 max-w-md md:left-auto md:right-4"
      role="region"
      aria-label="Informativa cookie"
    >
      <div ref={panelRef} className="glass-panel animate-slide-up space-y-3 rounded-xl border p-4 shadow-2xl">
        <div className="flex items-center gap-2">
          <Cookie className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-ink">Cookie e script di terze parti</h2>
        </div>

        <p className="text-sm leading-relaxed text-ink-muted">
          Usiamo cookie <strong className="text-ink">tecnici</strong> per tenere aperta la sessione
          e limitare gli abusi: senza non potresti restare connesso, quindi non sono opzionali.
        </p>
        <p className="text-sm leading-relaxed text-ink-muted">
          Puoi in più consentire il caricamento anticipato dello script di pagamento di
          <strong className="text-ink"> Stripe</strong>, che rende il checkout più rapido. Se
          rifiuti, viene caricato solo quando apri il modulo di pagamento. Non usiamo cookie
          analitici né pubblicitari.{' '}
          <Link to="/privacy" className="text-accent-glow underline">Informativa completa</Link>
        </p>

        <div className="flex items-center gap-2">
          <button onClick={() => decide(false)} className="btn-secondary flex-1 rounded-xl px-3 py-2 text-xs">
            Solo tecnici
          </button>
          <button onClick={() => decide(true)} className="btn-primary flex-1 rounded-xl px-3 py-2 text-xs">
            Consenti anche Stripe
          </button>
        </div>
      </div>
    </div>
  );
}
