const { isProduction } = require('../config/env');

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
      console.error('⚠️  RESEND_API_KEY non configurato: email NON inviata a', to);
      return { delivered: false, reason: 'mailer_non_configurato' };
    }
    // In test il contenuto non viene stampato: renderebbe illeggibile l'output.
    if (process.env.NODE_ENV !== 'test') {
      console.log(`\n📧 [sviluppo] Email non inviata, contenuto:\n   A: ${to}\n   Oggetto: ${subject}\n   ${text}\n`);
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
    console.error('Invio email fallito:', response.status, await response.text());
    return { delivered: false, reason: `http_${response.status}` };
  }

  return { delivered: true };
}

module.exports = { sendMail };
