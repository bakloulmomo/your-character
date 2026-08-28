/**
 * Identificativo di richiesta e logging HTTP (FASE E — punto 5).
 *
 * Ogni richiesta riceve un `requestId` che compare in TUTTE le righe di log che
 * produce, e viene restituito nell'intestazione `x-request-id`. È ciò che
 * trasforma un log in qualcosa di interrogabile: davanti a una segnalazione
 * («ho pagato e non ho ricevuto i crediti») si parte dall'identificativo e si
 * ricostruisce l'intera richiesta, invece di cercare a occhio fra righe di
 * testo libero che non sono legate fra loro.
 *
 * Se il proxy davanti all'app ne ha già assegnato uno, quello viene rispettato:
 * altrimenti la stessa richiesta avrebbe due nomi diversi nei due sistemi.
 */
const crypto = require('crypto');
const pinoHttp = require('pino-http');
const logger = require('../services/logger');

const HEADER = 'x-request-id';
// Un identificativo che arriva dall'esterno finisce nei log: va accettato solo
// se ha una forma innocua, altrimenti diventa un vettore di iniezione.
const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/;

const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers[HEADER];
    const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader(HEADER, id);
    return id;
  },
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    // Le sonde di salute sono rumore: non raccontano nulla e sommergono il resto.
    if (req.url === '/health') return 'silent';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} → ${res.statusCode}`,
  customErrorMessage: (req, res, err) => `${req.method} ${req.url} → ${res.statusCode} (${err.message})`,
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url, ip: req.remoteAddress }),
    res: (res) => ({ statusCode: res.statusCode })
  }
});

/**
 * Espone `req.log` (già arricchito con il requestId da pino-http) e `req.id`
 * al resto dell'applicazione.
 */
const requestContext = (req, res, next) => httpLogger(req, res, next);

module.exports = { requestContext, HEADER };
