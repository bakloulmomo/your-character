const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();
const connectDB = require('./config/db');
const { assertProductionEnv } = require('./config/env');
const logger = require('./services/logger');
const { requestContext } = require('./middleware/requestContext');
const { initErrorReporting, reportError } = require('./services/errorReporting');

const app = express();
const PORT = process.env.PORT || 5001;

// Dietro un reverse proxy (Render, Vercel, nginx) `req.ip` sarebbe l'indirizzo
// del proxy: tutti gli utenti condividerebbero la stessa chiave e cinque
// tentativi falliti di un singolo attaccante bloccherebbero il login a chiunque.
// Con `1` si considera attendibile un solo hop, quello del proxy.
app.set('trust proxy', 1);

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
  credentials: true
}));

// Stripe webhook requires the raw, unparsed body for HMAC signature verification.
// It MUST be mounted before express.json(), otherwise the body is consumed/re-serialized
// and the signature can never be validated (security-critical).
app.use('/api/payments/webhook', express.raw({ type: '*/*' }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Clerk Middleware (Safely handle mock/test environments)
if (process.env.CLERK_PUBLISHABLE_KEY && process.env.CLERK_PUBLISHABLE_KEY.startsWith('pk_test_c')) {
  try {
    const { clerkMiddleware } = require('@clerk/express');
    app.use(clerkMiddleware());
  } catch (e) {
    console.warn('Clerk middleware fallback mode active');
  }
}

/**
 * Logging strutturato con identificativo di richiesta (FASE E).
 *
 * Sostituisce `morgan`, che produceva una riga di testo libero per richiesta e
 * nient'altro: nessun identificativo, quindi nessun modo di collegare fra loro
 * le voci prodotte da una stessa chiamata, e nessuna redazione dei segreti.
 */
app.use(requestContext);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/characters', require('./routes/characters'));
app.use('/api/chats', require('./routes/chats'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/images', require('./routes/images'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/admin', require('./routes/admin'));

// File generati (immagini): serviti staticamente quando l'archiviazione è
// quella locale di sviluppo. In produzione con Cloudinary questa rotta resta
// inutilizzata perché gli URL puntano direttamente al CDN.
const { LOCAL_DIR, PUBLIC_PREFIX } = require('./services/storageService');
app.use(PUBLIC_PREFIX, express.static(LOCAL_DIR, { maxAge: '7d', fallthrough: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'your-character-backend',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development'
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

  res.status(status).json({
    error: {
      // Il messaggio interno di un 500 può contenere dettagli di
      // implementazione: all'utente arriva una formulazione neutra, la
      // diagnosi resta nel log insieme al requestId.
      message: status >= 500 ? 'Errore interno del server' : err.message || 'Richiesta non valida',
      status,
      requestId: req.id
    }
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
      app.listen(PORT, () => {
        logger.info(
          { port: PORT, env: process.env.NODE_ENV || 'development' },
          `your-character backend in ascolto sulla porta ${PORT}`
        );
      });
    });
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
