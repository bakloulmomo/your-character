/**
 * Consenso ai cookie e agli script di terze parti (FASE D — S2-6).
 *
 * La versione precedente scriveva una stringa in `localStorage` che nessuno
 * leggeva: la scelta non governava nulla, la "X" equivaleva ad accettare, e
 * dopo la prima volta non era più modificabile.
 *
 * Qui il consenso governa una cosa reale e verificabile: se lo script di
 * Stripe possa essere caricato in anticipo. Senza consenso `funzionale` non
 * viene caricato all'avvio; viene caricato SOLO quando la persona apre il
 * modulo di pagamento, perché a quel punto serve a eseguire il contratto che
 * ha appena richiesto — non è più una questione di consenso.
 *
 * Non dichiariamo categorie che non usiamo: non c'è analitica né pubblicità,
 * quindi non c'è un interruttore per esse. Un banner che offre scelte finte è
 * lo stesso difetto di prima con più caselle.
 */

export const CONSENT_VERSION = '2026-08-28';
const STORAGE_KEY = 'yc_cookie_consent_v2';
// Chiave della vecchia implementazione: va ignorata, non ereditata. Un valore
// raccolto da un banner che non governava nulla non è un consenso valido.
const LEGACY_KEY = 'yc_cookie_consent';

export interface ConsentState {
  /** Sempre attivi: sessione, sicurezza, prevenzione degli abusi. Nessuna scelta. */
  essential: true;
  /** Script di terze parti caricabili in anticipo (oggi: Stripe.js). */
  functional: boolean;
  version: string;
  decidedAt: string;
}

type Listener = (state: ConsentState | null) => void;
const listeners = new Set<Listener>();

function read(): ConsentState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentState;
    if (!parsed || typeof parsed.functional !== 'boolean') return null;
    return parsed;
  } catch {
    // Modalità privata o storage bloccato: si tratta come "nessuna scelta".
    return null;
  }
}

/** Lo stato attuale, oppure `null` se la persona non ha ancora scelto. */
export function getConsent(): ConsentState | null {
  return read();
}

/** True quando va mostrato il banner: mai scelto, o scelto su una versione superata. */
export function needsDecision(): boolean {
  const current = read();
  return !current || current.version !== CONSENT_VERSION;
}

/** Il solo consumo previsto: «posso caricare Stripe.js in anticipo?» */
export function hasFunctionalConsent(): boolean {
  return read()?.functional === true;
}

export function setConsent(functional: boolean): ConsentState {
  const state: ConsentState = {
    essential: true,
    functional,
    version: CONSENT_VERSION,
    decidedAt: new Date().toISOString()
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Se non si può scrivere, la scelta vale per questa sessione: meglio che
    // ignorarla del tutto.
  }

  listeners.forEach((listener) => listener(state));
  return state;
}

/** Notifica i componenti quando la scelta cambia (banner ↔ impostazioni). */
export function subscribeConsent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
