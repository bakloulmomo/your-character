const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createChatSchema } = require('../utils/validation');
const Chat = require('../models/Chat');
const Character = require('../models/Character');
const Message = require('../models/Message');
const { serverFailure } = require('../services/failure');

// POST /api/chats - Start a new chat session with a character
router.post('/', requireAuth, validate(createChatSchema), async (req, res) => {
  try {
    const { characterId, title } = req.body;
    const userId = req.user._id;

    const character = await Character.findById(characterId);

    // Un personaggio privato è utilizzabile solo dal suo creatore. Senza questo
    // controllo bastava conoscere un id per conversare con il personaggio
    // privato di chiunque — 404 anche qui, per non rivelarne l'esistenza.
    // Alla stessa regola si aggiunge la revisione: un personaggio pubblico che
    // non l'ha superata non è chattabile da terzi, altrimenti la coda di
    // moderazione varrebbe solo per la vetrina e non per l'uso (S2-2).
    const isOwner = character && character.createdBy.toString() === userId.toString();
    const isVisible = character && (isOwner || (character.isPublic && character.moderationStatus === 'approved'));
    if (!isVisible) {
      return res.status(404).json({ error: 'Character non trovato' });
    }

    // Contenuti per adulti: stessa condizione della galleria (S2-3).
    if (character.isNSFW && !isOwner && !req.user.canSeeNSFW()) {
      return res.status(403).json({
        error: 'Questo personaggio contiene contenuti per adulti. Per parlarci devi essere maggiorenne e attivare la relativa preferenza nelle impostazioni.',
        requiresAgeVerification: true
      });
    }

    const chatTitle = title || `Chat con ${character.name}`;

    const chat = await Chat.create({
      userId,
      characterId,
      title: chatTitle
    });

    // Create initial greeting message if available
    if (character.greetingMessage) {
      await Message.create({
        chatId: chat._id,
        role: 'assistant',
        content: character.greetingMessage,
        model: 'system-greeting'
      });
      chat.messageCount = 1;
      await chat.save();
    }

    // Incremento ATOMICO del contatore.
    //
    // Prima era `character.chatCount += 1; await character.save()`: una
    // lettura-modifica-scrittura, quindi due chat aperte nello stesso istante
    // ne registravano una sola. È la stessa classe di difetto già corretta
    // altrove nel progetto (S1-5, S1-11).
    //
    // C'è anche una seconda ragione: da quando `systemPrompt` è `select: false`,
    // il documento caricato qui non lo contiene, e risalvarlo farebbe scattare
    // il hook `pre('save')` che lo rigenera dai campi correnti. `$inc` tocca
    // solo il contatore e non rilegge nulla.
    await Character.findByIdAndUpdate(characterId, { $inc: { chatCount: 1 } });

    res.status(201).json(chat);
  } catch (error) {
    serverFailure(req, res, error, 'Impossibile creare la chat');
  }
});

// GET /api/chats - List all chats of authenticated user
router.get('/', requireAuth, async (req, res) => {
  try {
    const chats = await Chat.find({ userId: req.user._id })
      .populate('characterId', 'name avatar description isNSFW category')
      // Per ATTIVITA', non per data di creazione. `updatedAt` non si muoveva
      // mai (vedi il hook sul modello), quindi questa lista era ordinata per
      // quando le conversazioni erano state APERTE — l'esatto contrario di
      // quello che una cronologia deve fare, e in contraddizione con gli orari
      // relativi che l'interfaccia mostra accanto a ogni riga.
      .sort({ lastMessageAt: -1 })
      .lean();

    res.json(chats);
  } catch (error) {
    serverFailure(req, res, error, 'Impossibile recuperare lo storico delle chat');
  }
});

// GET /api/chats/:id - Get specific chat details
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.id, userId: req.user._id })
      .populate('characterId')
      .lean();

    if (!chat) {
      return res.status(404).json({ error: 'Chat non trovata' });
    }

    res.json(chat);
  } catch (error) {
    serverFailure(req, res, error, 'Errore nel recupero della chat');
  }
});

// DELETE /api/chats/:id - Delete a chat session and associated session context
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const chatId = req.params.id;
    const userId = req.user._id;

    const chat = await Chat.findOne({ _id: chatId, userId });
    if (!chat) {
      return res.status(404).json({ error: 'Chat non trovata' });
    }

    await Promise.all([
      Chat.findByIdAndDelete(chatId),
      Message.deleteMany({ chatId }),
      /**
       * Il contatore del personaggio scende quando la conversazione sparisce.
       *
       * L'apertura lo incrementava e nessun percorso lo decrementava mai:
       * `chatCount` poteva solo crescere. È il numero mostrato sulla card e
       * sulla scheda come «N conversazioni», quindi si allontanava dalla realtà
       * a ogni eliminazione e non tornava più indietro.
       *
       * `$max` a 0 non esiste in MongoDB: si decrementa solo se c'è qualcosa da
       * decrementare, così un contatore già a zero non diventa negativo.
       */
      Character.updateOne(
        { _id: chat.characterId, chatCount: { $gt: 0 } },
        { $inc: { chatCount: -1 } }
      )
    ]);

    res.json({ success: true, message: 'Chat eliminata con successo' });
  } catch (error) {
    serverFailure(req, res, error, 'Impossibile eliminare la chat');
  }
});

module.exports = router;
