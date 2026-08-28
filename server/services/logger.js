/**
 * Logging strutturato (FASE E — punto 5).
 *
 * Prima l'osservabilità erano `console.log` e `morgan`: righe di testo libero,
 * senza un identificativo che legasse fra loro le voci di una stessa richiesta.
 * Quando qualcosa andava storto in produzione non c'era modo di ricostruire
 * *quale* richiesta avesse prodotto quale errore — e in un'app che chiama
 * modelli a pagamento questo significa non poter nemmeno rispondere a «perché
 * questo utente è stato addebitato».
 *
 * Qui ogni riga è JSON con un `requestId`, e i dati sensibili sono redatti
 * nella configurazione del logger, non a mano nei punti di chiamata: una
 * redazione che dipende dalla disciplina di chi scrive il log è una redazione
 * che prima o poi manca.
 */
const pino = require('pino');
const { isProduction, isTest } = require('../config/env');

/**
 * Campi che non devono MAI comparire nei log, in nessuna forma.
 * `remove: true` cancella la chiave invece di sostituirla con `[Redacted]`:
 * un segreto oscurato resta comunque un segreto trasmesso al servizio di log.
 */
const REDACTED = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-mock-clerk-id"]',
  'req.body.password',
  'req.body.passwordHash',
  'req.body.token',
  'res.headers["set-cookie"]',
  'password',
  'passwordHash',
  'token',
  'clientSecret',
  'stripe-signature'
];

const prettyAvailable = () => {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
};

const level = process.env.LOG_LEVEL || (isTest() ? 'silent' : isProduction() ? 'info' : 'debug');

const logger = pino({
  level,
  redact: { paths: REDACTED, remove: true },
  base: {
    service: 'your-character-api',
    env: process.env.NODE_ENV || 'development'
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // In sviluppo il JSON puro è illeggibile a occhio; in produzione è l'unico
  // formato che un aggregatore sappia interrogare.
  //
  // `pino-pretty` è una dipendenza di sviluppo: se non è installata (deploy con
  // `npm ci --omit=dev` e NODE_ENV impostato male) il logger deve continuare a
  // funzionare in JSON, non far cadere il processo all'avvio.
  ...(isProduction() || isTest() || !prettyAvailable()
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service,env' }
        }
      })
});

module.exports = logger;
module.exports.REDACTED = REDACTED;
