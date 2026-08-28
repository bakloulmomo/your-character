/**
 * Applicazione della moderazione ai percorsi conversazionali (FASE D — S2-1).
 *
 * Le tre rotte dei messaggi (invio, streaming, rigenerazione) condividono le
 * stesse decisioni. Tenerle qui invece di ripeterle tre volte evita che le
 * copie divergano — che è esattamente come nasce la falla in una sola di esse.
 */
const { moderateText, CRISIS_MESSAGE, CRISIS_RESOURCES } = require('./moderationService');
const { recordViolation } = require('./moderationLog');
const { recordModeration } = require('./metrics');

/**
 * Controlla ciò che l'utente sta per inviare.
 *
 * @returns {{action: 'allow'|'block'|'crisis', verdict: object}}
 */
async function screenUserMessage({ content, user, chatId }) {
  const verdict = moderateText(content);

  if (verdict.severity === 'block') {
    recordModeration('blocked');
    await recordViolation({
      verdict,
      reporter: user,
      targetType: 'user',
      targetId: user._id,
      targetOwnerId: user._id,
      snippet: content,
      context: `messaggio utente · chat ${chatId || '-'}`
    });
    return { action: 'block', verdict };
  }

  if (verdict.severity === 'crisis') {
    recordModeration('crisis');
    // Nessuna segnalazione: una persona che dice di stare male non è un caso di
    // abuso da istruire a un moderatore, è qualcuno a cui rispondere bene.
    return { action: 'crisis', verdict };
  }

  if (verdict.severity === 'flag') {
    recordModeration('flagged');
    await recordViolation({
      verdict,
      reporter: user,
      targetType: 'user',
      targetId: user._id,
      targetOwnerId: user._id,
      snippet: content,
      context: `tentativo di manipolazione del prompt · chat ${chatId || '-'}`
    });
  }

  return { action: 'allow', verdict };
}

const OUTPUT_REFUSAL =
  'Non posso proseguire in questa direzione: la risposta che stavo per dare viola le regole della piattaforma. ' +
  'Possiamo continuare la conversazione su un altro binario. Nessun credito è stato addebitato.';

/**
 * Controlla ciò che il modello ha prodotto, PRIMA di mostrarlo.
 *
 * È la superficie che prima non veniva guardata affatto: un personaggio scritto
 * per aggirare le istruzioni poteva far dire al modello qualsiasi cosa, e quella
 * cosa arrivava all'utente intatta.
 *
 * @returns {{safe: boolean, content: string, verdict: object}}
 */
async function screenAiOutput({ content, user, character }) {
  const verdict = moderateText(content);

  if (verdict.severity !== 'block') {
    return { safe: true, content, verdict };
  }

  recordModeration('outputBlocked');

  // Il responsabile qui non è chi legge, è il personaggio che ha portato il
  // modello fin lì: la segnalazione punta al personaggio e al suo autore.
  await recordViolation({
    verdict,
    reporter: user,
    targetType: 'character',
    targetId: character._id,
    targetOwnerId: character.createdBy,
    snippet: content,
    context: `risposta del modello · personaggio ${character.name}`
  });

  return { safe: false, content: OUTPUT_REFUSAL, verdict };
}

module.exports = {
  screenUserMessage,
  screenAiOutput,
  OUTPUT_REFUSAL,
  CRISIS_MESSAGE,
  CRISIS_RESOURCES
};
