const express = require('express');
const router = express.Router();
const { requireAuth, attachUser } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createCharacterSchema, isValidObjectId } = require('../utils/validation');
const Character = require('../models/Character');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const { createCharacterLimiter } = require('../middleware/rateLimit');
const { moderateCharacterProfile } = require('../services/moderationService');
const { recordViolation } = require('../services/moderationLog');

const { serverFailure } = require('../services/failure');

/**
 * Vista pubblica di un personaggio.
 * `systemPrompt` non esce MAI dalla API: è il lavoro del creatore ed esporlo
 * permetterebbe di estrarre e clonare le istruzioni di qualunque personaggio.
 */
const PUBLIC_FIELDS = '-systemPrompt';


/**
 * Neutralizza i metacaratteri delle espressioni regolari nel testo cercato:
 * senza questo, un input come `(a+)+$` diventerebbe una regex catastrofica
 * capace di bloccare il processo (ReDoS).
 */
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * La regola di visibilità sta in `utils/visibility.js`, non qui.
 *
 * Era scritta a mano in questo file, nel filtro della galleria e dentro
 * `routes/chats.js`. Cambiandola in due punti su tre, il personaggio compariva
 * in galleria ma «Nuova conversazione» rispondeva 404.
 */
const { isOwner, isCharacterVisible: canView, VISIBLE_TO_OTHERS } = require('../utils/visibility');

/**
 * Contenuti per adulti (FASE D — S2-3).
 *
 * `GET /characters` era pubblico e non filtrava `isNSFW`: personaggi per adulti
 * finivano nella risposta servita a visitatori anonimi. Il controllo dell'età
 * esisteva solo nel modulo di registrazione, cioè in nessun punto che contasse.
 *
 * Servono entrambe le condizioni: maggiore età dichiarata E preferenza attivata.
 * Il proprietario resta un'eccezione: i propri contenuti si vedono sempre.
 */
const canSeeNSFW = (user) => !!user && typeof user.canSeeNSFW === 'function' && user.canSeeNSFW();

// GET /api/characters - List public characters with category filter, search, and pagination
router.get('/', attachUser, async (req, res) => {
  try {
    /**
     * Ogni parametro passa da `String()` PRIMA di toccare il filtro (S5).
     *
     * `express.urlencoded({ extended: true })` fa sì che `req.query` possa
     * contenere OGGETTI, non solo stringhe: `?tag[$ne]=x` arriva qui come
     * `{ $ne: 'x' }`. Due conseguenze, entrambe su una rotta pubblica e non
     * autenticata:
     *
     *  1. `tag.toLowerCase is not a function` → TypeError → 500 con lo stack in
     *     Sentry, generabile a volontà entro le 240 richieste al minuto del
     *     limite generale. Idem `search.trim()`.
     *  2. l'oggetto sarebbe finito in `filter` come operatore Mongo. Qui il
     *     danno era contenuto — `isPublic`, `moderationStatus` e `isNSFW` sono
     *     impostati a parte e non sovrascrivibili — ma la difesa non deve
     *     dipendere dall'ordine delle righe.
     *
     * `String({})` dà `'[object Object]'`, che semplicemente non trova nulla:
     * la direzione di fallimento giusta.
     */
    const testo = (v) => (v === undefined || v === null ? '' : String(v));
    const category = testo(req.query.category);
    const search = testo(req.query.search);
    const tag = testo(req.query.tag);

    const validLimit = Math.min(parseInt(testo(req.query.limit), 10) || 20, 50);
    /**
     * `Math.max(..., 1)` (S6). Senza, `?page=-5` dava `skip(-120)` e MongoDB
     * rispondeva «Skip value must be non-negative» → un altro 500 pubblico.
     * `admin.js` clampava già correttamente nelle sue due rotte equivalenti:
     * qui era rimasto fuori.
     */
    const pagina = Math.max(parseInt(testo(req.query.page), 10) || 1, 1);
    const skip = (pagina - 1) * validLimit;

    // La stessa regola di `canView`, in forma di filtro: pubblico e non rimosso.
    const filter = { ...VISIBLE_TO_OTHERS };

    // I contenuti per adulti restano fuori dalla galleria per chiunque non sia
    // un utente maggiorenne che li ha esplicitamente richiesti.
    if (!canSeeNSFW(req.user)) {
      filter.isNSFW = { $ne: true };
    }

    if (category && category !== 'all') {
      filter.category = category;
    }

    if (tag) {
      filter.tags = tag.toLowerCase();
    }

    if (search && search.trim().length > 0) {
      // Ricerca per sottostringa, non `$text`. Due ragioni:
      //  1. `$text` richiede un indice testuale già costruito: sulla prima
      //     ricerca di un database nuovo falliva con 500.
      //  2. `$text` cerca parole intere con stemming, quindi digitando "mar"
      //     non trovava "Marcus" — l'opposto di ciò che l'utente si aspetta
      //     mentre scrive.
      const term = escapeRegex(search.trim().slice(0, 80));
      filter.$or = [
        { name: { $regex: term, $options: 'i' } },
        { description: { $regex: term, $options: 'i' } },
        { tags: { $regex: term, $options: 'i' } }
      ];
    }

    const [characters, total] = await Promise.all([
      Character.find(filter)
        .select(PUBLIC_FIELDS)
        .populate('createdBy', 'username avatar')
        .sort({ usageCount: -1, createdAt: -1 })
        .skip(skip)
        .limit(validLimit)
        .lean(),
      Character.countDocuments(filter)
    ]);

    // Nessun personaggio di ripiego: una lista vuota è un'informazione vera,
    // sette personaggi inventati sono una bugia (e le loro card danno 404).
    res.json({
      characters,
      pagination: {
        page: pagina,
        limit: validLimit,
        total,
        totalPages: Math.ceil(total / validLimit)
      }
    });
  } catch (error) {
    serverFailure(req, res, error, 'Impossibile recuperare i personaggi');
  }
});

// GET /api/characters/my-characters - Get characters created by authenticated user
router.get('/my-characters', requireAuth, async (req, res) => {
  try {
    const characters = await Character.find({ createdBy: req.user._id })
      .select(PUBLIC_FIELDS)
      .sort({ createdAt: -1 })
      .lean();

    res.json(characters);
  } catch (error) {
    serverFailure(req, res, error, 'Impossibile recuperare i tuoi character');
  }
});

// GET /api/characters/:id - Dettaglio personaggio.
// Autenticazione opzionale: serve solo a riconoscere il proprietario di un
// personaggio privato. Per tutti gli altri un personaggio privato semplicemente
// non esiste (404, non 403: non si rivela nemmeno che c'è).
router.get('/:id', attachUser, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'ID personaggio non valido' });
    }

    const character = await Character.findById(req.params.id)
      .select(PUBLIC_FIELDS)
      .populate('createdBy', 'username avatar')
      .lean();

    if (!character || !canView(character, req.user)) {
      return res.status(404).json({ error: 'Character non trovato' });
    }

    // Stessa regola della galleria anche sul link diretto: senza di essa
    // bastava conoscere l'indirizzo per aggirare il filtro.
    if (character.isNSFW && !isOwner(character, req.user) && !canSeeNSFW(req.user)) {
      return res.status(403).json({
        error: 'Questo personaggio contiene contenuti per adulti. Per aprirlo devi essere maggiorenne e attivare la relativa preferenza nelle impostazioni.',
        requiresAgeVerification: true
      });
    }

    res.json(character);
  } catch (error) {
    serverFailure(req, res, error, 'Impossibile recuperare il personaggio');
  }
});

/**
 * Il testo del personaggio passa dalla moderazione prima di essere salvato
 * (FASE D — S2-1): i metadati erano l'unica delle tre superfici a non essere
 * guardata da nulla, e sono quella che finisce in galleria davanti a tutti.
 */
async function screenProfile(body, user, res) {
  const verdict = moderateCharacterProfile(body);
  if (verdict.severity === 'block') {
    await recordViolation({
      verdict,
      reporter: user,
      targetType: 'user',
      targetId: user._id,
      targetOwnerId: user._id,
      snippet: body[verdict.field],
      context: `metadati personaggio · campo ${verdict.field}`
    });
    res.status(400).json({
      error: `Il campo «${verdict.fieldLabel}» non può essere pubblicato: ${verdict.reason}`,
      field: verdict.field,
      category: verdict.category
    });
    return false;
  }
  return true;
}

/**
 * Stato di visibilità all'atto del salvataggio.
 *
 * Restituisce `'approved'` per tutti: un personaggio nasce visibile, e il campo
 * ora significa «non rimosso» invece di «già esaminato». Chi l'ha esaminato lo
 * dice `moderatedAt`, ed è quello a decidere cosa compare nella coda.
 *
 * Un'eccezione che NON è un dettaglio: un personaggio già respinto e poi
 * modificato dall'autore resta respinto. Rimetterlo a `'approved'` alla prima
 * modifica trasformerebbe la rimozione in un fastidio da aggirare cambiando una
 * virgola. Torna in coda per essere riesaminato, ma nel frattempo resta fuori
 * dalla galleria.
 */
const visibilityFor = (character) =>
  character.moderationStatus === 'rejected' ? 'rejected' : 'approved';

// POST /api/characters - Create a new custom character
router.post('/', requireAuth, createCharacterLimiter, validate(createCharacterSchema), async (req, res) => {
  try {
    if (!(await screenProfile(req.body, req.user, res))) return;

    // Pubblicare contenuti per adulti richiede di essere maggiorenni: senza
    // questo controllo l'age gate riguarderebbe solo chi guarda, non chi carica.
    if (req.body.isNSFW && !req.user.isAdult()) {
      return res.status(403).json({
        error: 'Per pubblicare contenuti per adulti devi aver dichiarato una data di nascita che ti renda maggiorenne.'
      });
    }

    const characterData = {
      ...req.body,
      createdBy: req.user._id,
      // Visibile subito. La revisione umana avviene dopo, sulla coda di ciò
      // che è pubblicato e non ancora guardato (`moderatedAt: null`).
      moderationStatus: 'approved',
      moderatedAt: null,
      systemPrompt: `You are ${req.body.name}. ${req.body.personality}. ${req.body.backstory ? `Backstory: ${req.body.backstory}` : ''}`
    };

    const character = await Character.create(characterData);
    const { systemPrompt, ...safe } = character.toObject();
    res.status(201).json(safe);
  } catch (error) {
    serverFailure(req, res, error, 'Impossibile creare il character');
  }
});

// PUT /api/characters/:id - Update an existing character
router.put('/:id', requireAuth, validate(createCharacterSchema), async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Identificativo non valido' });
    }

    const character = await Character.findById(req.params.id);
    if (!character) {
      return res.status(404).json({ error: 'Character non trovato' });
    }

    if (character.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Non hai i permessi per modificare questo character' });
    }

    if (!(await screenProfile(req.body, req.user, res))) return;

    if (req.body.isNSFW && !req.user.isAdult()) {
      return res.status(403).json({
        error: 'Per pubblicare contenuti per adulti devi aver dichiarato una data di nascita che ti renda maggiorenne.'
      });
    }

    Object.assign(character, req.body);
    character.systemPrompt = `You are ${req.body.name}. ${req.body.personality}. ${req.body.backstory ? `Backstory: ${req.body.backstory}` : ''}`;

    /**
     * Ogni modifica rimette il personaggio in coda.
     *
     * Approvare una versione e lasciar riscrivere liberamente il testo dopo
     * renderebbe la revisione una formalità aggirabile in un secondo momento.
     * `moderatedAt: null` è ciò che lo riporta davanti a un moderatore; la
     * visibilità nel frattempo la decide `visibilityFor`, che NON risuscita un
     * personaggio rimosso.
     */
    character.moderationStatus = visibilityFor(character);
    character.moderatedBy = null;
    character.moderatedAt = null;
    if (character.moderationStatus !== 'rejected') character.moderationReason = '';

    await character.save();
    const { systemPrompt, ...safe } = character.toObject();
    res.json(safe);
  } catch (error) {
    serverFailure(req, res, error, 'Impossibile aggiornare il character');
  }
});

// DELETE /api/characters/:id - Delete a character
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Identificativo non valido' });
    }

    const character = await Character.findById(req.params.id);
    if (!character) {
      return res.status(404).json({ error: 'Character non trovato' });
    }

    if (character.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Non hai i permessi per eliminare questo character' });
    }

    // Cancellazione a cascata: senza di essa le chat restavano puntando a un
    // personaggio inesistente e la lista chat restituiva `characterId: null`,
    // facendo fallire il render lato client (S1-10).
    const orphanChats = await Chat.find({ characterId: req.params.id }).select('_id').lean();
    const orphanChatIds = orphanChats.map((c) => c._id);

    await Promise.all([
      Message.deleteMany({ chatId: { $in: orphanChatIds } }),
      Chat.deleteMany({ characterId: req.params.id }),
      Character.findByIdAndDelete(req.params.id)
    ]);

    res.json({
      success: true,
      message: 'Character eliminato con successo',
      deletedChats: orphanChatIds.length
    });
  } catch (error) {
    serverFailure(req, res, error, 'Impossibile eliminare il character');
  }
});

module.exports = router;
