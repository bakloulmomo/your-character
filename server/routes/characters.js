const express = require('express');
const router = express.Router();
const { requireAuth, attachUser } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createCharacterSchema } = require('../utils/validation');
const Character = require('../models/Character');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const { createCharacterLimiter } = require('../middleware/rateLimit');
const { moderateCharacterProfile } = require('../services/moderationService');
const { recordViolation } = require('../services/moderationLog');

const mongoose = require('mongoose');

/**
 * Vista pubblica di un personaggio.
 * `systemPrompt` non esce MAI dalla API: è il lavoro del creatore ed esporlo
 * permetterebbe di estrarre e clonare le istruzioni di qualunque personaggio.
 */
const PUBLIC_FIELDS = '-systemPrompt';

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id);

/**
 * Neutralizza i metacaratteri delle espressioni regolari nel testo cercato:
 * senza questo, un input come `(a+)+$` diventerebbe una regex catastrofica
 * capace di bloccare il processo (ReDoS).
 */
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `createdBy` può essere un ObjectId o un documento popolato: normalizza l'id. */
const creatorId = (character) => {
  const c = character.createdBy;
  if (!c) return null;
  return (c._id || c).toString();
};

const isOwner = (character, user) => !!user && creatorId(character) === user._id.toString();

/**
 * Un personaggio è visibile a un terzo solo se è pubblico E ha superato la
 * revisione. Il creatore vede sempre il proprio, in qualunque stato: altrimenti
 * un personaggio in attesa sparirebbe anche a chi l'ha appena creato.
 */
const canView = (character, user) =>
  isOwner(character, user) || (character.isPublic && character.moderationStatus === 'approved');

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
    const { category, search, page = 1, limit = 20, tag } = req.query;
    const validLimit = Math.min(parseInt(limit) || 20, 50);
    const skip = (parseInt(page) - 1) * validLimit;

    const filter = { isPublic: true, moderationStatus: 'approved' };

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
        page: parseInt(page) || 1,
        limit: validLimit,
        total,
        totalPages: Math.ceil(total / validLimit)
      }
    });
  } catch (error) {
    console.error('List characters error:', error);
    res.status(500).json({ error: 'Impossibile recuperare i personaggi' });
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
    console.error('Get my characters error:', error);
    res.status(500).json({ error: 'Impossibile recuperare i tuoi character' });
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
    console.error('Get character details error:', error);
    res.status(500).json({ error: 'Impossibile recuperare il personaggio' });
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
 * Stato di revisione all'atto del salvataggio (FASE D — S2-2).
 *
 * Un personaggio PRIVATO è visibile solo al suo autore: non c'è nulla da
 * rivedere e resta immediatamente utilizzabile. Un personaggio PUBBLICO entra
 * in coda: prima bastava un click su una casella preselezionata per comparire
 * in galleria senza che nessuno avesse guardato nulla.
 */
const statusFor = (isPublic) => (isPublic ? 'pending' : 'approved');

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
      moderationStatus: statusFor(req.body.isPublic),
      systemPrompt: `You are ${req.body.name}. ${req.body.personality}. ${req.body.backstory ? `Backstory: ${req.body.backstory}` : ''}`
    };

    const character = await Character.create(characterData);
    const { systemPrompt, ...safe } = character.toObject();
    res.status(201).json(safe);
  } catch (error) {
    console.error('Create character error:', error);
    res.status(500).json({ error: 'Impossibile creare il character' });
  }
});

// PUT /api/characters/:id - Update an existing character
router.put('/:id', requireAuth, validate(createCharacterSchema), async (req, res) => {
  try {
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

    // Ogni modifica di un personaggio pubblico torna in coda: approvare una
    // versione e lasciar riscrivere liberamente il testo dopo l'approvazione
    // renderebbe la revisione una formalità aggirabile in un secondo momento.
    character.moderationStatus = statusFor(character.isPublic);
    character.moderatedBy = null;
    character.moderatedAt = null;
    character.moderationReason = '';

    await character.save();
    const { systemPrompt, ...safe } = character.toObject();
    res.json(safe);
  } catch (error) {
    console.error('Update character error:', error);
    res.status(500).json({ error: 'Impossibile aggiornare il character' });
  }
});

// DELETE /api/characters/:id - Delete a character
router.delete('/:id', requireAuth, async (req, res) => {
  try {
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
    console.error('Delete character error:', error);
    res.status(500).json({ error: 'Impossibile eliminare il character' });
  }
});

module.exports = router;
