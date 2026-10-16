/**
 * Chi può vedere un personaggio — LA regola, in un posto solo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Era scritta a mano in tre punti: `canView` nella scheda personaggio, il
 * filtro della galleria, e un controllo in linea dentro la creazione di una
 * conversazione. Tre copie della stessa frase, e quando la regola è cambiata —
 * dalla moderazione preventiva a quella successiva — ne sono state aggiornate
 * due. La terza è rimasta a pretendere `moderationStatus === 'approved'`, con
 * un effetto che dall'interfaccia sembrava tutt'altro: il personaggio compariva
 * in galleria, si apriva, mostrava il pulsante «Nuova conversazione», e il
 * pulsante rispondeva 404. Un difetto invisibile alla lettura di ciascun file e
 * ovvio solo mettendoli accanto.
 *
 * LA REGOLA: un personaggio è visibile a un terzo se è pubblico e non è stato
 * rimosso. Il creatore vede sempre il proprio, in qualunque stato — altrimenti
 * un personaggio appena rimosso sparirebbe anche a chi deve poterlo correggere.
 *
 * `!== 'rejected'` e non `=== 'approved'`: rende visibili anche i personaggi
 * rimasti `pending` da prima del passaggio alla moderazione successiva, senza
 * bisogno di migrare il database.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** `createdBy` può essere un ObjectId o un documento popolato: normalizza l'id. */
const creatorId = (character) => {
  const c = character && character.createdBy;
  if (!c) return null;
  return (c._id || c).toString();
};

const isOwner = (character, user) =>
  !!user && !!character && creatorId(character) === user._id.toString();

const isCharacterVisible = (character, user) =>
  !!character && (isOwner(character, user) || (character.isPublic && character.moderationStatus !== 'rejected'));

/**
 * La stessa regola come filtro Mongo, per gli elenchi.
 *
 * Vale per i terzi: chi elenca i PROPRI personaggi passa da un filtro su
 * `createdBy` e non ha bisogno di questo.
 */
const VISIBLE_TO_OTHERS = { isPublic: true, moderationStatus: { $ne: 'rejected' } };

module.exports = { creatorId, isOwner, isCharacterVisible, VISIBLE_TO_OTHERS };
