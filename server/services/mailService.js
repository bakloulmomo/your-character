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
    // In test il contenuto non viene stampato: renderebbe illeggibile l'output.
    if (process.env.NODE_ENV !== 'test') {
      logger.info({ to, subject, text }, 'Email non inviata (sviluppo): contenuto registrato');
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
