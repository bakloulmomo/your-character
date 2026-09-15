const { isProduction, devOutboxEnabled } = require('../config/env');
const logger = require('./logger');

/**
 * Invio email — un'interfaccia, due trasporti.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `sendMail({to, subject, text})` e' la sola firma che i chiamanti conoscono, e
 * non cambia: il recupero password e la notifica dei feedback non sanno da dove
 * esce il messaggio. Il trasporto si sceglie dalla configurazione, in
 * quest'ordine:
 *
 *   1. `RESEND_API_KEY`                 → Resend (API HTTP)
 *   2. `SMTP_HOST`+`SMTP_USER`+`SMTP_PASS` → SMTP (nodemailer)
 *   3. niente                            → nessun invio, solo log
 *
 * PERCHE' DUE, E PERCHE' RESEND VINCE. Resend richiede un dominio verificato
 * con SPF e DKIM. Finche' il dominio non c'e', SMTP e' l'unica strada che
 * recapita davvero — e recapitare male e' meglio che non recapitare, perche' un
 * codice di verifica che non arriva non e' un difetto di consegna, e' un
 * prodotto che non si puo' usare. L'ordine di precedenza fa si' che il giorno
 * in cui il dominio esiste basti aggiungere una variabile d'ambiente: nessuna
 * riga di codice cambia, e non c'e' un momento in cui entrambi sono attivi.
 *
 * LIMITE DA CONOSCERE. Con SMTP di una casella personale il mittente e'
 * quell'indirizzo, il tetto e' dell'ordine di qualche centinaio di messaggi al
 * giorno, e senza SPF/DKIM allineati una parte finira' nella posta indesiderata
 * — proprio i codici di verifica, che sono il caso in cui l'utente non insiste
 * e se ne va. E' un ripiego dichiarato, non una configurazione a regime: la
 * soglia oltre la quale il dominio non e' piu' rimandabile sta in `DEPLOY.md`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * La casella di sviluppo: gli ultimi messaggi che non sono partiti.
 *
 * Vive in memoria e si perde a ogni riavvio, che è esattamente quanto deve
 * durare. Il tetto è basso di proposito: non è un archivio, è l'ultimo tratto
 * di posta — e un elenco senza limite su un processo di sviluppo lasciato
 * acceso per giorni diventa una perdita di memoria silenziosa.
 */
const CAPIENZA_CASELLA = 50;
let casella = [];

const readOutbox = () => casella.slice().reverse();
const clearOutbox = () => { casella = []; };

/** Un solo nuovo tentativo, e solo per gli errori che possono passare da soli. */
const RETRY_DELAY_MS = Number(process.env.MAIL_RETRY_DELAY_MS) || 1500;

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

const mittente = () => process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@your-character.app';

/**
 * Quale trasporto e' configurato. Esportata perche' le rotte devono poter
 * distinguere «non ho inviato perche' non e' configurato» da «ho provato e non
 * ci sono riuscito»: sono due problemi diversi con due rimedi diversi.
 */
function mailTransport() {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  return 'none';
}

let trasportoSmtp = null;
let firmaSmtp = null;

/**
 * Il trasporto SMTP si costruisce una volta sola e si riusa: nodemailer tiene
 * un pool di connessioni, e aprirne una nuova a ogni email vanificherebbe il
 * pool e moltiplicherebbe le strette di mano TLS.
 *
 * La firma della configurazione fa parte della cache: nei test le variabili
 * cambiano fra un caso e l'altro, e un trasporto memorizzato con la
 * configurazione precedente renderebbe il secondo test una bugia.
 */
function getSmtpTransport() {
  const nodemailer = require('nodemailer');
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const firma = `${host}:${port}:${user}`;

  if (!trasportoSmtp || firmaSmtp !== firma) {
    trasportoSmtp = nodemailer.createTransport({
      host,
      port,
      // 465 e' TLS implicito, 587 e' STARTTLS: la regola e' derivata dalla
      // porta invece che da una variabile in piu' che si puo' sbagliare.
      secure: port === 465,
      auth: { user, pass },
      pool: true,
      maxConnections: 2
    });
    firmaSmtp = firma;
  }
  return trasportoSmtp;
}

/** Solo per i test: dimentica il trasporto memorizzato. */
function resetMailTransport() {
  if (trasportoSmtp && typeof trasportoSmtp.close === 'function') trasportoSmtp.close();
  trasportoSmtp = null;
  firmaSmtp = null;
}

async function inviaConResend({ to, subject, text, html }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: mittente(), to, subject, text, ...(html ? { html } : {}) })
  });

  if (!response.ok) {
    const corpo = await response.text();
    // 4xx e' una richiesta sbagliata (dominio non verificato, destinatario
    // rifiutato): ritentare la ripeterebbe identica. 5xx puo' passare.
    const err = new Error(`Resend ha risposto ${response.status}`);
    err.reason = `http_${response.status}`;
    err.ritentabile = response.status >= 500;
    err.dettaglio = corpo;
    throw err;
  }
  return { delivered: true, transport: 'resend' };
}

async function inviaConSmtp({ to, subject, text, html }) {
  try {
    await getSmtpTransport().sendMail({ from: mittente(), to, subject, text, ...(html ? { html } : {}) });
    return { delivered: true, transport: 'smtp' };
  } catch (e) {
    const err = new Error(`SMTP: ${e.message}`);
    err.reason = 'smtp_error';
    // `responseCode` 4xx in SMTP significa «riprova piu' tardi», 5xx e'
    // definitivo. Senza codice si tratta come errore di rete: ritentabile.
    err.ritentabile = !e.responseCode || (e.responseCode >= 400 && e.responseCode < 500);
    throw err;
  }
}

/**
 * @returns {Promise<{delivered: boolean, reason?: string, transport?: string}>}
 *          Non solleva mai: chi invia un'email non deve poter far fallire
 *          l'operazione per cui l'email era solo una notifica.
 */
async function sendMail({ to, subject, text, html }) {
  const trasporto = mailTransport();

  if (trasporto === 'none') {
    if (isProduction()) {
      logger.error({ to }, 'Nessun trasporto email configurato: email NON inviata');
      return { delivered: false, reason: 'mailer_non_configurato' };
    }
    /**
     * Il CORPO dell'email non finisce nel log (S8).
     *
     * Qui c'era `logger.info({ to, subject, text }, ...)`. Il `text` del
     * recupero password contiene l'URL completo con il token, e la lista
     * `REDACTED` del logger intercetta `'token'` come chiave di primo livello,
     * non un token annidato DENTRO il valore di `text`. In qualunque ambiente
     * senza mailer e con `NODE_ENV` diverso da `production` e `test` bastava
     * chiamare `/forgot-password` con l'email di chiunque e leggere i log.
     */
    if (devOutboxEnabled()) {
      casella.push({ to, subject, text, at: new Date().toISOString() });
      if (casella.length > CAPIENZA_CASELLA) casella.shift();
    }

    /**
     * L'OGGETTO non finisce più nel log.
     *
     * Era `{ to, subject }`, e sembrava innocuo finché l'oggetto è «Recupero
     * password». Ma il codice di conferma viaggia proprio lì — `Il tuo codice:
     * 123456`, che è la scelta giusta per chi lo legge dalla notifica sul
     * telefono e la peggiore per un log. È la stessa fuga già chiusa per il
     * corpo (S8), rientrata da un campo diverso.
     *
     * Chi sviluppa il codice lo legge dalla casella qui sopra, che esiste
     * apposta ed è spenta in produzione da due condizioni.
     */
    if (process.env.NODE_ENV !== 'test') {
      logger.info({ to }, 'Email non inviata (nessun trasporto configurato)');
    }
    return { delivered: false, reason: 'sviluppo' };
  }

  const invia = trasporto === 'resend' ? inviaConResend : inviaConSmtp;

  for (let tentativo = 1; tentativo <= 2; tentativo++) {
    try {
      return await invia({ to, subject, text, html });
    } catch (err) {
      const ultimo = tentativo === 2 || !err.ritentabile;
      logger[ultimo ? 'error' : 'warn'](
        { trasporto, tentativo, reason: err.reason, err: { message: err.message } },
        ultimo ? 'Invio email fallito' : 'Invio email fallito, ritento'
      );
      if (ultimo) return { delivered: false, reason: err.reason || 'errore', transport: trasporto };
      await attendi(RETRY_DELAY_MS);
    }
  }

  /* istanbul ignore next — irraggiungibile: il ciclo esce sempre da dentro. */
  return { delivered: false, reason: 'errore', transport: trasporto };
}

module.exports = { sendMail, mailTransport, resetMailTransport, readOutbox, clearOutbox };
