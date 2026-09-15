const express = require('express');
const router = express.Router();
const { readOutbox, clearOutbox } = require('../services/mailService');

/**
 * Rotte di SVILUPPO. Non esistono in produzione.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Questo router non viene nemmeno costruito se `devOutboxEnabled()` è falso:
 * il montaggio in `server.js` è dentro un `if`, quindi in produzione le rotte
 * rispondono 404 come qualunque indirizzo inventato — non 403, che
 * rivelerebbe che esistono.
 *
 * Due condizioni indipendenti le tengono chiuse: `NODE_ENV` fuori produzione E
 * `DEV_OUTBOX=1` impostata a mano. In più `assertProductionEnv()` fa fallire
 * l'avvio se la variabile compare in produzione, perché quella casella
 * contiene codici di conferma e link di recupero password in chiaro.
 *
 * A che cosa serve davvero: senza un trasporto email configurato, la conferma
 * dell'indirizzo era impercorribile fuori produzione — il codice esiste solo
 * come impronta SHA-256, quindi non si recupera nemmeno dal database. La suite
 * end-to-end si fermava su cinque percorsi su nove. Con questa casella i test
 * attraversano la verifica VERA, quella che attraversa anche un utente, invece
 * di una scorciatoia che nessuno percorre mai.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// GET /api/dev/outbox — le ultime email non inviate, la più recente per prima.
router.get('/outbox', (req, res) => {
  const to = typeof req.query.to === 'string' ? req.query.to.toLowerCase() : null;
  const messaggi = readOutbox().filter((m) => !to || String(m.to).toLowerCase() === to);
  res.json({ messages: messaggi });
});

// DELETE /api/dev/outbox — svuota, così un test non legge il codice di quello prima.
router.delete('/outbox', (req, res) => {
  clearOutbox();
  res.json({ success: true });
});

module.exports = router;
