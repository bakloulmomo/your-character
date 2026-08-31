/**
 * Registrazione delle violazioni rilevate dalla moderazione (FASE D — S2-1, S2-13).
 *
 * `moderationService` decide, questo modulo ricorda. Sono separati di proposito:
 * la decisione è pura e verificabile senza database, la registrazione ha bisogno
 * di Mongo e non deve mai far fallire la richiesta che la origina.
 *
 * Una violazione ripetuta NON produce una nuova riga: incrementa `occurrences`
 * sulla segnalazione aperta per quel bersaglio e quella categoria. Prima 50
 * segnalazioni identiche producevano 50 documenti indistinguibili che nessuno
 * avrebbe potuto esaminare.
 */
const Report = require('../models/Report');
const logger = require('./logger');

const EVIDENCE_MAX = 480;

/** Categorie della moderazione che hanno un corrispettivo nell'enum di Report. */
const REPORTABLE = new Set([
  'sexual_minors',
  'sexual_violence',
  'violence_instructions',
  'self_harm_instructions',
  'illegal_drugs',
  'prompt_injection'
]);

/**
 * @param {object} params
 * @param {object} params.verdict   esito di moderateText / moderateCharacterProfile
 * @param {object} params.reporter  utente che ha originato o incontrato il contenuto
 * @param {'user'|'character'|'message'} params.targetType
 * @param {object} params.targetId
 * @param {object} [params.targetOwnerId]
 * @param {string} [params.snippet] testo incriminato (viene troncato)
 * @param {string} [params.context] dove è successo, per chi esamina
 */
async function recordViolation({ verdict, reporter, targetType, targetId, targetOwnerId = null, snippet = '', context = '' }) {
  try {
    if (!verdict || !verdict.category || !REPORTABLE.has(verdict.category)) return null;
    if (!reporter || !targetId) return null;

    const evidence = `${context ? `[${context}] ` : ''}${(snippet || verdict.match || '').toString()}`.slice(0, EVIDENCE_MAX);

    return await Report.findOneAndUpdate(
      {
        source: 'automatic',
        targetType,
        targetId,
        reason: verdict.category,
        status: 'pending'
      },
      {
        $inc: { occurrences: 1 },
        $set: {
          severity: verdict.severity,
          evidence,
          targetOwnerId,
          updatedAt: new Date()
        },
        $setOnInsert: {
          reporterId: reporter._id || reporter,
          description: verdict.reason || '',
          createdAt: new Date()
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    // Una segnalazione non registrata è un problema di osservabilità, non un
    // motivo per rifiutare una richiesta che è già stata decisa.
    logger.error({ err: { message: error.message } }, 'Registrazione della violazione di moderazione fallita');
    return null;
  }
}

module.exports = { recordViolation, REPORTABLE };
