const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireVerifiedEmail } = require('../middleware/requireVerifiedEmail');
const { validate } = require('../middleware/validate');
const { createChatSchema, isValidObjectId } = require('../utils/validation');
const { isOwner, isCharacterVisible } = require('../utils/visibility');
const Chat = require('../models/Chat');
const Character = require('../models/Character');
const Message = require('../models/Message');
const { serverFailure } = require('../services/failure');

// POST /api/chats - Start a new chat session with a character
router.post('/', requireAuth, requireVerifiedEmail, validate(createChatSchema), async (req, res) => {
  try {
    const { characterId, title } = req.body;
    const userId = req.user._id;

    const character = await Character.findById(characterId);

    /**
     * La stessa regola della galleria e della scheda, non una sua copia.
     *
     * Qui la condizione era riscritta a mano e pretendeva ancora
     * `moderationStatus === 'approved'`. Con il passaggio alla moderazione
     * successiva le altre due copie sono state aggiornate e questa no, e il
     * risultato era un difetto che dall'interfaccia non somigliava affatto alla
     * sua causa: il personaggio compariva in galleria, si apriva, mostrava il
     * pulsante «Nuova conversazione» — e il pulsante rispondeva 404.
     *
     * 404 e non 403, come altrove: un personaggio privato non deve rivelare
     * nemmeno di esistere.
     */
    const proprietario = isOwner(character, req.user);
    if (!isCharacterVisible(character, req.user)) {
      return res.status(404).json({ error: 'Character non trovato' });
    }

    // Contenuti per adulti: stessa condizione della galleria (S2-3).
    if (character.isNSFW && !proprietario && !req.user.canSeeNSFW()) {
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

/**
 * GET /api/chats — la cronologia delle conversazioni.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ERA SENZA LIMITE. `Chat.find({userId})` senza `.limit()`, con un `populate`
 * per riga, su una rotta che la barra laterale chiama a OGNI caricamento di
 * pagina. Con dieci conversazioni non si nota; con mille — un utente affezionato
 * dopo un anno — sono mille documenti piu' mille join a ogni navigazione, per
 * mostrarne venti sullo schermo. Il costo non cresce con quello che si guarda,
 * cresce con quanto si e' usato il prodotto: esattamente il modo sbagliato,
 * perche' colpisce per primi gli utenti migliori.
 *
 * Paginazione a CURSORE e non a offset, come gia' fatto per i messaggi: la
 * lista e' ordinata per ultima attivita' e cambia mentre la si scorre — con
 * `skip` una conversazione che riceve un messaggio scala di posizione e ricompare
 * nella pagina successiva, o sparisce. Il cursore e' immune perche' ancora la
 * pagina a un valore, non a una posizione.
 *
 * `lastMessageAt` puo' essere identico su piu' righe (creazioni ravvicinate),
 * quindi il cursore usa la coppia con `_id` come spareggio: senza, due chat con
 * lo stesso istante si nasconderebbero a vicenda.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MAX_CHAT_PAGE = 50;

router.get('/', requireAuth, async (req, res) => {
  try {
    const limite = Math.min(
      Math.max(Number.parseInt(String(req.query.limit || ''), 10) || 30, 1),
      MAX_CHAT_PAGE
    );

    const filtro = { userId: req.user._id };

    // `before` e' il `lastMessageAt` dell'ultima riga gia' ricevuta.
    const before = String(req.query.before || '');
    if (before && !Number.isNaN(Date.parse(before))) {
      filtro.lastMessageAt = { $lt: new Date(before) };
    }

    // Si chiede una riga in piu' del necessario: e' come si sa se ce ne sono
    // altre senza pagare un `countDocuments` sull'intera collezione.
    const righe = await Chat.find(filtro)
      .populate('characterId', 'name avatar description isNSFW category')
      // Per ATTIVITA', non per data di creazione. `updatedAt` non si muoveva
      // mai (vedi il hook sul modello), quindi questa lista era ordinata per
      // quando le conversazioni erano state APERTE — l'esatto contrario di
      // quello che una cronologia deve fare, e in contraddizione con gli orari
      // relativi che l'interfaccia mostra accanto a ogni riga.
      .sort({ lastMessageAt: -1, _id: -1 })
      .limit(limite + 1)
      .lean();

    const hasMore = righe.length > limite;
    const chats = hasMore ? righe.slice(0, limite) : righe;
    const ultima = chats[chats.length - 1];

    /**
     * La risposta resta un ARRAY.
     *
     * Il client legge `res.data` come lista in `useChats`, e trasformarla in
     * `{chats, hasMore}` avrebbe rotto la barra laterale in silenzio — un array
     * vuoto e un oggetto sono entrambi «veri» in JavaScript, quindi il sintomo
     * sarebbe stato una cronologia vuota senza alcun errore. La continuazione
     * viaggia in un'intestazione, dove non puo' rompere nessuno.
     */
    res.set('X-Has-More', hasMore ? 'true' : 'false');
    if (hasMore && ultima && ultima.lastMessageAt) {
      res.set('X-Next-Cursor', new Date(ultima.lastMessageAt).toISOString());
    }

    res.json(chats);
  } catch (error) {
    serverFailure(req, res, error, 'Impossibile recuperare lo storico delle chat');
  }
});

// GET /api/chats/:id - Get specific chat details
router.get('/:id', requireAuth, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Identificativo non valido' });
    }

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
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Identificativo non valido' });
    }

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
