/**
 * Raccolta degli errori del client (FASE E — punto 5).
 *
 * Stessa regola del server: senza `VITE_SENTRY_DSN` non si inizializza nulla e
 * gli errori restano nella console del browser. Non si finge una raccolta che
 * non sta avvenendo.
 *
 * Cosa NON viene inviato: il testo delle conversazioni. `beforeSend` toglie i
 * dati delle richieste, perché un servizio di error tracking non è il posto in
 * cui debbano finire i messaggi privati di qualcuno.
 *
 * Nota sul peso: `VITE_SENTRY_DSN` è una costante di compilazione, quindi in una
 * build senza DSN il ramo che usa l'SDK è codice morto e Rollup lo elimina —
 * verificato: 444 KB senza DSN, 532 KB con. Chi non configura la raccolta non
 * scarica nemmeno la libreria.
 */
import * as Sentry from '@sentry/react';

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

let active = false;

export function initMonitoring() {
  if (!DSN) return false;

  try {
    Sentry.init({
      dsn: DSN,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_APP_RELEASE as string | undefined,
      tracesSampleRate: 0,
      sendDefaultPii: false,
      beforeSend(event) {
        if (event.request) {
          delete event.request.data;
          delete event.request.cookies;
          if (event.request.headers) delete event.request.headers.Authorization;
        }
        return event;
      }
    });
    active = true;
    return true;
  } catch {
    return false;
  }
}

export function reportError(error: unknown, context?: Record<string, unknown>) {
  if (active) {
    Sentry.captureException(error, context ? { extra: context } : undefined);
    return;
  }
  // Senza raccolta configurata l'errore deve restare visibile a chi sviluppa,
  // non sparire in silenzio.
  console.error('[monitoring]', error, context ?? '');
}

export const isMonitoringActive = () => active;
