const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
require('dotenv').config();
const connectDB = require('./config/db');
const { assertProductionEnv, devOutboxEnabled } = require('./config/env');
const logger = require('./services/logger');
const { requestContext } = require('./middleware/requestContext');
const { initErrorReporting, reportError } = require('./services/errorReporting');
const { scheduleRetention } = require('./services/retention');

const app = express();
const PORT = process.env.PORT || 5001;

// Dietro un reverse proxy (Render, Vercel, nginx) `req.ip` sarebbe l'indirizzo
// del proxy: tutti gli utenti condividerebbero la stessa chiave e cinque
// tentativi falliti di un singolo attaccante bloccherebbero il login a chiunque.
// Con `1` si considera attendibile un solo hop, quello del proxy.
app.set('trust proxy', 1);

/**
 * Querystring PIATTA: `?tag[$ne]=x` arriva come la stringa `'[object Object]'`,
 * non come un operatore Mongo.
 *
 * Con il parser predefinito (`extended`, cioè `qs`) un parametro può arrivare
 * come OGGETTO, e ogni rotta che lo infila in un filtro deve ricordarsi di
 * neutralizzarlo. `characters.js` lo fa, con un commento che spiega perché — ma
 * è disciplina riga per riga, e la disciplina la si dimentica alla prossima
 * rotta scritta di fretta. Qui la possibilità sparisce per tutte le rotte
 * insieme: `req.query` contiene solo stringhe e array di stringhe.
 *
 * Le difese `String(...)` già presenti restano dove sono: due strati che si
 * sovrappongono vanno bene, uno solo che si può dimenticare no.
 *
 * (Nota per chi legge `routes/characters.js:55`: quel commento attribuisce il
 * comportamento a `express.urlencoded`, ma in Express il parser della
 * querystring è indipendente dal parser dei corpi. La difesa era giusta, la
 * spiegazione no.)
 */
app.set('query parser', 'simple');

/**
 * Intestazioni di sicurezza (FASE D — S2-15).
 *
 * La CSP era disattivata con il commento «for dev flexibility», in un file che
 * è anche il server di produzione: la comodità di uno sviluppatore è rimasta
 * accesa su ogni ambiente.
 *
 * Questa API non serve HTML e non esegue script: la policy giusta è quella che
 * nega tutto e riabilita solo ciò che serve davvero, cioè le immagini generate
 * servite staticamente. Non è la policy del client — quella sta nelle
 * intestazioni dell'hosting statico (client/vercel.json e client/public/_headers),
 * perché è lì che vive la pagina.
 */
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      'default-src': ["'none'"],
      'script-src': ["'none'"],
      'style-src': ["'none'"],
      // Le immagini generate sono servite da questa origine; `data:` copre le
      // anteprime incorporate.
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
      'frame-ancestors': ["'none'"],
      'object-src': ["'none'"]
    }
  },
  // Le immagini generate vengono caricate dal client, che sta su un'altra
  // origine: il default `same-origin` di helmet le bloccherebbe.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  /**
   * Le intestazioni di paginazione vanno DICHIARATE esposte.
   *
   * `GET /chats` restituisce un array e manda la continuazione in
   * `X-Has-More` / `X-Next-Cursor`. Oggi funziona perché l'API è same-origin —
   * proxy di Vite in sviluppo, riscrittura di Vercel in produzione — e il
   * browser lascia leggere tutto. Ma è una dipendenza tacita: il giorno in cui
   * qualcuno pubblicasse l'API su un sottodominio, quelle due intestazioni
   * sparirebbero dal client senza alcun errore, e la cronologia si fermerebbe
   * alle prime trenta conversazioni senza che nulla lo spieghi.
   *
   * Dichiararle costa una riga e toglie di mezzo un guasto che si manifesta
   * solo dopo un cambio di infrastruttura, cioè quando nessuno lo sta cercando.
   */
  exposedHeaders: ['X-Has-More', 'X-Next-Cursor']
}));

// Stripe webhook requires the raw, unparsed body for HMAC signature verification.
// It MUST be mounted before express.json(), otherwise the body is consumed/re-serialized
// and the signature can never be validated (security-critical).
app.use('/api/payments/webhook', express.raw({ type: '*/*' }));

// 10 MB erano dimensionati sulle immagini in base64 dentro i documenti, che
// non esistono piu': ora i binari vanno all'archivio e in database resta l'URL.
// Un messaggio di chat e' al massimo 4000 caratteri, un personaggio poche
// migliaia: 256 KB sono abbondanti, e riducono di quaranta volte quanto un
// singolo client puo' far allocare al processo.
app.use(express.json({ limit: '256kb' }));

/**
 * `express.urlencoded` NON viene montato, e la sua assenza e' una difesa.
 *
 * Nessuna rotta di questa API legge un corpo in forma di modulo: il client
 * parla JSON, il webhook di Stripe vuole il corpo grezzo. Montare comunque il
 * parser dei moduli lasciava aperta l'unica forma di richiesta che un sito
 * terzo puo' costruire senza il permesso del browser — un `<form>` con
 * `Content-Type: application/x-www-form-urlencoded` parte cross-origin, senza
 * preflight, portandosi dietro il cookie di sessione.
 *
 * E' il vettore CSRF classico, ed e' anche la ragione per cui questo progetto
 * puo' permettersi di non avere token CSRF: `SameSite=Lax` piu' API
 * same-origin coprono i casi pratici FINCHE' l'unico modo di parlare con la API
 * e' un corpo JSON, che una richiesta cross-site semplice non puo' produrre.
 * Riaggiungere questa riga significa rimettere in discussione quella scelta.
 */

/**
 * Il middleware Clerk NON viene più montato (S2).
 *
 * La condizione era `CLERK_PUBLISHABLE_KEY.startsWith('pk_test_c')`: una chiave
 * di TEST accendeva un percorso di autenticazione anche in produzione, che è la
 * direzione di fallimento sbagliata — la stessa scelta altrove nel progetto va
 * nel verso opposto (`isProduction()` in config/env.js tratta come produzione
 * qualunque ambiente non dichiarato).
 *
 * Il ramo che ne dipendeva, in `middleware/auth.js`, creava account con i
 * crediti di benvenuto scavalcando il codice d'invito della beta chiusa. Clerk
 * era già stato abbandonato dappertutto: restava solo quel pezzo.
 */

/**
 * Logging strutturato con identificativo di richiesta (FASE E).
 *
 * Sostituisce `morgan`, che produceva una riga di testo libero per richiesta e
 * nient'altro: nessun identificativo, quindi nessun modo di collegare fra loro
 * le voci prodotte da una stessa chiamata, e nessuna redazione dei segreti.
 */
app.use(requestContext);

/**
 * Limite generale, applicato a tutta la API prima di ogni rotta.
 *
 * Sta DOPO `requestContext` di proposito: una richiesta rifiutata deve
 * comunque comparire nei log con il suo identificativo, altrimenti un abuso in
 * corso e' invisibile proprio mentre sta avvenendo.
 */
const { globalLimiter } = require('./middleware/rateLimit');
app.use('/api', globalLimiter);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/characters', require('./routes/characters'));
app.use('/api/chats', require('./routes/chats'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/images', require('./routes/images'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/admin', require('./routes/admin'));

/**
 * Rotte di sviluppo — montate solo se DAVVERO abilitate.
 *
 * Il router non viene nemmeno costruito quando la condizione è falsa, quindi
 * in produzione `/api/dev/outbox` risponde 404 come qualunque indirizzo
 * inventato: non 403, che rivelerebbe che esiste. La condizione richiede
 * `NODE_ENV` fuori produzione E `DEV_OUTBOX=1`, e `assertProductionEnv()` fa
 * fallire l'avvio se quella variabile compare in produzione.
 */
if (devOutboxEnabled()) {
  app.use('/api/dev', require('./routes/dev'));
}

// File generati (immagini): serviti staticamente quando l'archiviazione è
// quella locale di sviluppo. In produzione con Cloudinary questa rotta resta
// inutilizzata perché gli URL puntano direttamente al CDN.
const { LOCAL_DIR, PUBLIC_PREFIX } = require('./services/storageService');
app.use(PUBLIC_PREFIX, express.static(LOCAL_DIR, { maxAge: '7d', fallthrough: true }));

/**
 * Configurazione pubblica dell'istanza.
 *
 * Il client deve sapere che cosa è acceso PRIMA di disegnare l'interfaccia:
 * un pulsante «Ricarica crediti» che porta a un 404 è peggio di un pulsante
 * assente. Non è una difesa — quella sta sulle rotte, in `featureGate` — è
 * solo il modo in cui l'interfaccia evita di promettere ciò che non esiste.
 *
 * Espone unicamente interruttori, mai segreti né dettagli di configurazione.
 */
app.get('/api/config', (req, res) => {
  const { features, betaInviteCode, mockPaymentsEnabled } = require('./config/env');
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    features: features(),
    /**
     * Se il denaro si muove davvero. Lo decide il SERVER, in base alla propria
     * chiave: prima l'interfaccia lo deduceva dalla presenza di una chiave
     * pubblicabile lato client, che e' un'informazione diversa. Con una chiave
     * pubblicabile configurata e un server in modalita' simulata, la finestra
     * di pagamento esibiva «Pagamento sicuro con Stripe» su un acquisto che
     * non passava da Stripe — una dichiarazione falsa, ed esattamente il
     * difetto che il percorso end-to-end era stato scritto per impedire.
     */
    paymentsMode: mockPaymentsEnabled() ? 'mock' : 'live',
    // Solo SE serve un invito, mai quale: il modulo deve poter mostrare il
    // campo, non superare il controllo.
    inviteRequired: !!betaInviteCode()
  });
});

/**
 * Sonda di salute — e «salute» qui vuol dire «può servire una richiesta».
 *
 * Prima rispondeva `200 ok` incondizionatamente: un processo vivo con il
 * database irraggiungibile si dichiarava sano, quindi Render lo teneva in
 * rotazione e ogni richiesta rispondeva 500. Una sonda che non può fallire non
 * è una sonda, è una decorazione — ed è esattamente lo scenario in cui serve.
 *
 * Si guarda `readyState`, non si esegue una query: la sonda viene chiamata di
 * continuo e non deve diventare essa stessa un carico. Gli stati sono
 * 0 disconnesso · 1 connesso · 2 in connessione · 3 in disconnessione.
 *
 * `env` non c'è più: diceva a chiunque quale ambiente sta girando, su una rotta
 * pubblica e non limitata, senza servire a nessuno che non abbia già accesso ai
 * log.
 */
app.get('/health', (req, res) => {
  const connesso = mongoose.connection.readyState === 1;
  res.status(connesso ? 200 : 503).json({
    status: connesso ? 'ok' : 'degraded',
    service: 'your-character-backend',
    database: connesso ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

/**
 * Rotta API inesistente.
 *
 * Senza questo blocco rispondeva Express con la sua pagina HTML di default
 * («Cannot GET /api/...», `content-type: text/html`). Un client che chiama una
 * API JSON e riceve una pagina HTML non ha modo di leggere l'errore: `data` è
 * una stringa di markup, `data.error` è `undefined`, e l'utente vede il
 * messaggio generico di ripiego qualunque cosa sia successo. Vale anche per un
 * refuso in un indirizzo dopo un deploy parziale, che è il momento in cui
 * sapere quale rotta manca conta di più.
 */
app.use('/api', (req, res) => {
  res.status(404).json({
    error: `Rotta non trovata: ${req.method} ${req.baseUrl}${req.path}`,
    requestId: req.id
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  const status = err.status || 500;

  (req.log || logger).error(
    { err: { message: err.message, stack: err.stack }, route: req.originalUrl },
    'Errore non gestito'
  );

  if (status >= 500) {
    reportError(err, { requestId: req.id, route: req.originalUrl, userId: req.user && req.user._id });
  }

  /**
   * `error` è una STRINGA, come nelle altre 174 risposte di errore della API.
   *
   * Qui era un oggetto `{ message, status, requestId }`, e nessun test copriva
   * questo gestore. Il client legge `data.error` in sedici punti e lo passa
   * direttamente a `notify()` o dentro il JSX: ricevendo un oggetto, React
   * solleva «Objects are not valid as a React child» e l'intera pagina viene
   * sostituita dalla schermata dell'ErrorBoundary. Cioè: qualunque eccezione
   * non gestita sul server non produceva un avviso, produceva il crollo
   * dell'interfaccia — l'errore peggiore possibile in risposta a un errore.
   *
   * Il `requestId` resta, come campo affiancato: serve a collegare la
   * segnalazione dell'utente alla riga di log, e non deve costare la
   * leggibilità del messaggio.
   */
  res.status(status).json({
    // Il messaggio interno di un 500 può contenere dettagli di
    // implementazione: all'utente arriva una formulazione neutra, la
    // diagnosi resta nel log insieme al requestId.
    error: status >= 500 ? 'Errore interno del server' : err.message || 'Richiesta non valida',
    status,
    requestId: req.id
  });
});

/**
 * Sequenza di avvio, esposta come funzione così che i test possano verificare
 * che la validazione dell'ambiente venga davvero eseguita — e non solo che
 * esista. Questa guardia era già stata rimossa una volta senza che alcun test
 * se ne accorgesse, perché i test di S0-4 chiamavano `assertProductionEnv()`
 * direttamente invece di passare dal percorso di avvio.
 */
async function bootstrap() {
  // Fail-fast: una configurazione di produzione incompleta farebbe ripiegare
  // l'app sui percorsi simulati (pagamenti finti, risposte AI finte, segreto
  // JWT di default). Meglio non partire affatto.
  // `async` di proposito: così un errore di configurazione e un errore di
  // connessione arrivano allo stesso gestore, invece di uno come eccezione
  // sincrona e l'altro come promise rifiutata.
  assertProductionEnv();
  initErrorReporting();

  return connectDB()
    .then(() => {
      const server = app.listen(PORT, () => {
        logger.info(
          { port: PORT, env: process.env.NODE_ENV || 'development' },
          `your-character backend in ascolto sulla porta ${PORT}`
        );
      });
      installShutdown(server);
      // La pulizia parte DOPO la connessione: prima non avrebbe un database a
      // cui parlare, e il primo giro avviene all'avvio invece di aspettare sei
      // ore — su un servizio che si riavvia spesso, un timer lungo e basta non
      // scatterebbe mai.
      scheduleRetention();
      return server;
    });
}

/**
 * Spegnimento pulito.
 *
 * Render manda `SIGTERM` a ogni deploy e a ogni riavvio, e senza un gestore il
 * processo muore all'istante: le richieste in volo vengono troncate a metà
 * risposta. Sul percorso dei messaggi questo è peggio di una risposta mancata —
 * il credito è già stato riservato e la chiamata al modello è già stata pagata,
 * quindi l'utente perde il credito E la risposta.
 *
 * L'ordine conta: prima si smette di accettare connessioni nuove, poi si
 * lasciano finire quelle aperte, poi si chiude il database. Chiudere Mongo per
 * primo farebbe fallire proprio le richieste che stiamo cercando di salvare.
 *
 * Il timer è la rete di sicurezza: se dopo `SHUTDOWN_TIMEOUT_MS` qualcosa è
 * ancora appeso (una risposta in streaming che non termina, tipicamente) si
 * esce comunque. `unref()` perché questo timer non deve, da solo, tenere vivo
 * il processo che sta cercando di morire.
 */
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 15000;

function installShutdown(server) {
  let inCorso = false;

  const spegni = async (segnale) => {
    if (inCorso) return;
    inCorso = true;
    logger.info({ segnale }, 'Spegnimento in corso: non accetto più connessioni');

    const scadenza = setTimeout(() => {
      logger.warn({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Spegnimento forzato: richieste ancora in volo');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    scadenza.unref();

    try {
      await new Promise((resolve) => server.close(resolve));
      await mongoose.connection.close(false);
      logger.info('Spegnimento completato');
      process.exit(0);
    } catch (err) {
      logger.error({ err: { message: err.message } }, 'Errore durante lo spegnimento');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => spegni('SIGTERM'));
  process.on('SIGINT', () => spegni('SIGINT'));
}

if (process.env.NODE_ENV !== 'test') {
  Promise.resolve()
    .then(bootstrap)
    .catch((err) => {
      // Un errore di avvio deve restare leggibile a occhio anche quando il
      // logger non è ancora il canale che qualcuno sta guardando.
      logger.fatal({ err: err.message }, 'Avvio non riuscito');
      console.error(`\n${err.message}\n`);
      process.exit(1);
    });
}

module.exports = app;
// Esposto DOPO l'assegnazione di `app`, altrimenti verrebbe sovrascritto.
module.exports.bootstrap = bootstrap;
