const User = require('../models/User');
const Report = require('../models/Report');
const logger = require('./logger');
const { isTest } = require('../config/env');

/**
 * Le scadenze promesse, applicate davvero.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `PrivacyPage.tsx` dichiara agli utenti tre periodi di conservazione: token di
 * recupero un'ora, segnalazioni ventiquattro mesi, log novanta giorni. Erano
 * promesse senza esecutore: nessun indice TTL, nessun job, nessuna riga che le
 * facesse avvenire. Un periodo di conservazione scritto nell'informativa e non
 * applicato nel codice non è un dettaglio di igiene — è una dichiarazione falsa
 * resa all'interessato, ed è la prima cosa che un'ispezione confronta.
 *
 * PERCHÉ NON INDICI TTL. Sarebbero la soluzione ovvia e qui sono la trappola:
 * un indice TTL cancella il DOCUMENTO INTERO, non il campo. Su `User` un TTL
 * legato a `passwordResetExpiresAt` cancellerebbe l'account un'ora dopo aver
 * chiesto di recuperare la password. Il TTL resta lo strumento giusto solo dove
 * la scadenza del campo coincide con la fine di ciò che il documento
 * rappresenta.
 *
 * PERCHÉ NON TUTTE LE SEGNALAZIONI. Si cancellano solo quelle CHIUSE. Una
 * segnalazione ancora aperta dopo due anni è un problema di moderazione, non di
 * conservazione: farla sparire da sola nasconderebbe proprio il caso che
 * nessuno ha mai guardato.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Ventiquattro mesi, come promesso nell'informativa. */
const REPORT_RETENTION_MS = 730 * 24 * 60 * 60 * 1000;

/** Ogni sei ore: la granularità che serve, non un timer al minuto. */
const SWEEP_INTERVAL_MS = Number(process.env.RETENTION_SWEEP_MS) || 6 * 60 * 60 * 1000;

/**
 * Cancella l'impronta dei token di recupero già scaduti.
 *
 * Il token scaduto è già inutilizzabile — la rotta ne verifica la scadenza —
 * quindi questo non chiude una falla: mantiene la promessa di non conservarlo.
 */
async function purgeExpiredResetTokens(now = new Date()) {
  const res = await User.updateMany(
    { passwordResetExpiresAt: { $ne: null, $lt: now } },
    { $set: { passwordResetTokenHash: null, passwordResetExpiresAt: null } }
  );
  return res.modifiedCount || 0;
}

/** Elimina le segnalazioni CHIUSE più vecchie del periodo dichiarato. */
async function purgeOldClosedReports(now = new Date()) {
  const soglia = new Date(now.getTime() - REPORT_RETENTION_MS);
  const res = await Report.deleteMany({
    status: { $in: ['reviewed', 'actioned', 'dismissed'] },
    createdAt: { $lt: soglia }
  });
  return res.deletedCount || 0;
}

/**
 * Una passata completa. Restituisce quanto ha fatto, così un test può
 * verificare l'effetto invece della sola assenza di eccezioni.
 *
 * Non solleva mai: la pulizia è manutenzione, e una manutenzione che abbatte il
 * processo è peggio del disordine che rimuove.
 */
async function runRetentionSweep(now = new Date()) {
  const esito = { resetTokens: 0, reports: 0, errors: [] };

  for (const [nome, fn] of [
    ['resetTokens', purgeExpiredResetTokens],
    ['reports', purgeOldClosedReports]
  ]) {
    try {
      esito[nome] = await fn(now);
    } catch (err) {
      esito.errors.push(nome);
      logger.error({ err: { message: err.message }, fase: nome }, 'Pulizia di conservazione non riuscita');
    }
  }

  if (esito.resetTokens || esito.reports) {
    logger.info(esito, 'Pulizia di conservazione eseguita');
  }
  return esito;
}

/**
 * Avvia la pulizia periodica. `unref()` perché questo timer non deve tenere
 * vivo un processo che sta cercando di spegnersi.
 */
function scheduleRetention() {
  if (isTest()) return null;

  runRetentionSweep().catch(() => {});
  const timer = setInterval(() => { runRetentionSweep().catch(() => {}); }, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = {
  runRetentionSweep,
  purgeExpiredResetTokens,
  purgeOldClosedReports,
  scheduleRetention,
  REPORT_RETENTION_MS
};
