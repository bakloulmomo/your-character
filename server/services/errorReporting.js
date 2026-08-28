/**
 * Segnalazione degli errori a Sentry (FASE E — punto 5).
 *
 * Vale la stessa regola del resto del progetto: se non è configurato, lo dice.
 * Senza `SENTRY_DSN` non si inizializza nulla e gli errori restano nel log
 * strutturato — non si finge una raccolta che non sta avvenendo.
 *
 * Nota su cosa NON viene inviato: i corpi delle richieste non escono da qui.
 * Un messaggio di chat è il contenuto privato di una conversazione, e un
 * servizio di error tracking non è il posto in cui debba finire.
 */
const logger = require('./logger');
const { isProduction } = require('../config/env');

let Sentry = null;
let enabled = false;

function initErrorReporting() {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    // In produzione è un'assenza degna di nota, non un dettaglio: senza, un
    // errore visto da un utente non raggiunge nessuno.
    logger[isProduction() ? 'warn' : 'info'](
      'SENTRY_DSN non configurato: gli errori restano nel log locale e non vengono raccolti.'
    );
    return false;
  }

  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      release: process.env.APP_RELEASE || undefined,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
      // I corpi delle richieste contengono messaggi di conversazione: non escono.
      sendDefaultPii: false,
      beforeSend(event) {
        if (event.request) {
          delete event.request.data;
          delete event.request.cookies;
          if (event.request.headers) {
            delete event.request.headers.authorization;
            delete event.request.headers.cookie;
          }
        }
        return event;
      }
    });
    enabled = true;
    logger.info('Raccolta errori attiva (Sentry).');
    return true;
  } catch (err) {
    logger.error({ err: err.message }, 'Inizializzazione di Sentry fallita: si prosegue senza.');
    return false;
  }
}

/**
 * Riporta un errore, arricchito con l'identificativo della richiesta così che
 * la voce su Sentry e le righe nel log si possano incrociare.
 */
function reportError(error, context = {}) {
  if (!enabled || !Sentry) return false;
  try {
    Sentry.withScope((scope) => {
      if (context.requestId) scope.setTag('requestId', context.requestId);
      if (context.route) scope.setTag('route', context.route);
      if (context.userId) scope.setUser({ id: String(context.userId) });
      Sentry.captureException(error);
    });
    return true;
  } catch {
    return false;
  }
}

const isErrorReportingEnabled = () => enabled;

module.exports = { initErrorReporting, reportError, isErrorReportingEnabled };
