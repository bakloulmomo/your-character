const { isProduction } = require('../config/env');
const logger = require('./logger');

/**
 * Invio email.
 *
 * L'implementazione reale richiede un fornitore configurato (RESEND_API_KEY).
 * Senza, in sviluppo il messaggio viene scritto nei log invece di essere
 * inviato — così il flusso di recupero password è percorribile localmente
 * senza fingere che una email sia partita.
 */
async function sendMail({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || 'no-reply@your-character.app';

  if (!apiKey) {
    if (isProduction()) {
      logger.error({ to }, 'RESEND_API_KEY non configurato: email NON inviata');
      return { delivered: false, reason: 'mailer_non_configurato' };
    }
    /**
     * Il CORPO dell'email non finisce nel log (S8).
     *
     * Qui c'era `logger.info({ to, subject, text }, ...)`. Il `text` del
     * recupero password è costruito in `routes/auth.js` e contiene l'URL
     * completo con il token:
     *
     *     .../reset-password?token=<segreto valido 60 minuti>
     *
     * La lista `REDACTED` del logger include `'token'` come chiave di primo
     * livello: non intercetta un token annidato DENTRO il valore di `text`.
     * Quindi in qualunque ambiente senza `RESEND_API_KEY` e con `NODE_ENV`
     * diverso da `production` e `test` — staging, anteprima, un container di
     * sviluppo condiviso — bastava chiamare `/forgot-password` con l'email di
     * chiunque e leggere i log per prendersi quell'account.
     *
     * Che in produzione la riga non venisse emessa non è una difesa: era una
     * difesa per ambiente, non per costruzione. Ora nel log finiscono solo il
     * destinatario e l'oggetto, che bastano a capire che l'invio è avvenuto.
     */
    if (process.env.NODE_ENV !== 'test') {
      logger.info({ to, subject }, 'Email non inviata (sviluppo): destinatario e oggetto');
    }
    return { delivered: false, reason: 'sviluppo' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from, to, subject, text })
  });

  if (!response.ok) {
    logger.error({ status: response.status, body: await response.text() }, 'Invio email fallito');
    return { delivered: false, reason: `http_${response.status}` };
  }

  return { delivered: true };
}

module.exports = { sendMail };
