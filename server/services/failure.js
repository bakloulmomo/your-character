/**
 * Il punto unico in cui un guasto del server viene registrato e riferito.
 *
 * Il progetto aveva già tutto quello che serve: un logger strutturato con un
 * `requestId` che lega fra loro le righe di una stessa chiamata
 * (`middleware/requestContext.js`) e una raccolta errori verso Sentry
 * (`services/errorReporting.js`). Nessuna delle due era però collegata a dove
 * i guasti accadono davvero.
 *
 * Misurato prima di questa correzione: 59 chiamate a `console.*` sparse fra
 * rotte e servizi, e `reportError` invocato in UN solo punto — il gestore
 * globale in fondo a `server.js`. Ma quel gestore riceve solo gli errori che
 * nessuno ha catturato, e ogni rotta cattura i propri: trenta blocchi
 * `catch { console.error(...); res.status(500)... }`. Conseguenza pratica: un
 * errore durante la registrazione, l'accesso, l'invio di un messaggio, un
 * pagamento o la creazione di un personaggio finiva su stdout, senza
 * identificativo di richiesta, e non raggiungeva MAI la raccolta errori.
 *
 * Cioè: l'osservabilità era stata costruita e non collegata — la stessa forma
 * di difetto che il progetto ha già corretto altrove («l'endpoint esisteva e
 * non era mai stato chiamato»), spostata di un livello.
 *
 * Qui la registrazione avviene una volta sola, nel formato giusto, con il
 * `requestId` in entrambi i sistemi, così che una segnalazione di un utente
 * («ho pagato e non ho ricevuto i crediti») si possa incrociare con la riga di
 * log e con la voce su Sentry.
 */
const logger = require('./logger');
const { reportError } = require('./errorReporting');

/**
 * Registra un guasto e risponde al client.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {unknown} error    L'eccezione catturata.
 * @param {string}  message  Il messaggio destinato all'utente. Deve descrivere
 *                           l'operazione fallita, non l'errore interno.
 * @param {number}  [status] Il codice HTTP; 500 se non indicato.
 */
function serverFailure(req, res, error, message, status = 500) {
  const err = error instanceof Error ? error : new Error(String(error));

  (req.log || logger).error(
    { err: { message: err.message, stack: err.stack }, route: req.originalUrl },
    message
  );

  // Un 4xx è una richiesta sbagliata, non un guasto: va nei log, non nella
  // raccolta degli errori, altrimenti il rumore seppellisce i guasti veri.
  if (status >= 500) {
    reportError(err, {
      requestId: req.id,
      route: req.originalUrl,
      userId: req.user && req.user._id
    });
  }

  /**
   * Sulla rotta di streaming l'intestazione parte con il primo pezzo di
   * risposta: un guasto a metà trasmissione trovava le intestazioni già
   * inviate, e `res.status().json()` sollevava a sua volta
   * `ERR_HTTP_HEADERS_SENT` — un secondo errore, questa volta non gestito,
   * sopra il primo.
   */
  if (res.headersSent) return;

  res.status(status).json({ error: message, requestId: req.id });
}

/**
 * Registra una condizione anomala che NON impedisce di rispondere.
 *
 * Il caso tipico è il rimborso dei crediti dopo un invio fallito: se anche
 * quello fallisce, la risposta all'utente resta la stessa, ma la traccia serve
 * — è denaro che non è tornato indietro.
 */
function warnFailure(req, error, message) {
  const err = error instanceof Error ? error : new Error(String(error));
  (req && req.log ? req.log : logger).warn(
    { err: { message: err.message }, route: req && req.originalUrl },
    message
  );
}

/**
 * Registra un guasto SENZA rispondere.
 *
 * Serve dove la risposta la produce già qualcun altro — la rotta di streaming
 * ha il proprio `fail()`, che deve scegliere fra un corpo JSON e un evento SSE
 * a seconda di quanto è già stato trasmesso. Prima quel percorso registrava con
 * `console.error` e non raggiungeva la raccolta errori: un guasto a metà
 * risposta, cioè il più difficile da ricostruire, era anche l'unico che non
 * lasciava traccia correlata.
 */
function logFailure(req, error, message) {
  const err = error instanceof Error ? error : new Error(String(error));
  (req.log || logger).error(
    { err: { message: err.message, stack: err.stack }, route: req.originalUrl },
    message
  );
  reportError(err, {
    requestId: req.id,
    route: req.originalUrl,
    userId: req.user && req.user._id
  });
}

module.exports = { serverFailure, warnFailure, logFailure };
