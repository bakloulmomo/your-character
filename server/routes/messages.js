const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { sendMessageSchema } = require('../utils/validation');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Character = require('../models/Character');
const User = require('../models/User');
const { reserveAllowance } = require('../models/User');
const { screenUserMessage, screenAiOutput, CRISIS_MESSAGE, CRISIS_RESOURCES } = require('../services/moderationGuards');
const { moderateText } = require('../services/moderationService');
const { buildContext, maybeSummarize } = require('../services/contextManager');
const { generateResponse, generateResponseStream } = require('../services/geminiService');
const { applyDailyReset, applySubscriptionExpiry } = require('../utils/time');
const { messageLimiter } = require('../middleware/rateLimit');
const { recordCall } = require('../services/metrics');

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

// POST /api/messages - Invia un messaggio e riceve la risposta del personaggio
router.post('/', requireAuth, messageLimiter, validate(sendMessageSchema), async (req, res) => {
  const { chatId, content } = req.body;
  const userId = req.user._id;
  let reservation = null;

  try {
    // 1. Scadenza abbonamento e azzeramento contatori giornalieri
    await applySubscriptionExpiry(req.user);
    await applyDailyReset(req.user);

    // 2. Moderazione dell'INPUT (prima di spendere qualsiasi cosa)
    const screening = await screenUserMessage({ content, user: req.user, chatId });
    if (screening.action === 'block') {
      return res.status(400).json({ error: screening.verdict.reason, category: screening.verdict.category });
    }

    // 3. Chat e personaggio
    const chat = await Chat.findOne({ _id: chatId, userId });
    if (!chat) {
      return res.status(404).json({ error: 'Chat non trovata' });
    }

    const character = await Character.findById(chat.characterId);
    if (!character) {
      return res.status(404).json({ error: 'Character associato non trovato' });
    }

    // 3-bis. Crisi: il messaggio non va al modello e non costa nulla.
    //   Rispondere «contenuto contrario alle linee guida» a chi dice di volersi
    //   fare del male sarebbe la reazione peggiore possibile; il personaggio
    //   esce dalla finzione e indica un aiuto reale.
    if (screening.action === 'crisis') {
      const userMessage = await Message.create({ chatId, role: 'user', content });
      const aiMessage = await Message.create({
        chatId,
        role: 'assistant',
        content: CRISIS_MESSAGE,
        model: 'safety-notice',
        safetyNotice: true
      });
      await Chat.findByIdAndUpdate(chatId, { $inc: { messageCount: 2 }, lastMessageAt: new Date() });

      return res.json({
        userMessage,
        aiMessage,
        safety: { type: 'crisis', resources: CRISIS_RESOURCES },
        user: { credits: req.user.credits, subscription: req.user.subscription }
      });
    }

    // 4. RISERVA l'allowance prima della chiamata al modello.
    //    Controllo e addebito avvengono in una sola operazione atomica: senza
    //    questo, N richieste simultanee superavano tutte il controllo e
    //    ricevevano tutte una risposta pagandone solo alcune (S1-1, S1-2).
    reservation = await reserveAllowance(userId, req.user.subscription, 'message');
    if (!reservation) {
      return res.status(402).json({
        error: 'Crediti esauriti o limite giornaliero raggiunto per il tuo piano. Effettua una ricarica o aggiorna il tuo piano.'
      });
    }

    // 5. Messaggio dell'utente
    const userMessage = await Message.create({ chatId, role: 'user', content });

    // 6. Contesto ricostruito dai messaggi salvati (nessun documento condiviso
    //    da riscrivere, quindi nessun aggiornamento perso)
    const context = await buildContext(chat, character);

    // 7. Chiamata al modello
    let aiResult;
    try {
      aiResult = await generateResponse(context, character.name);
    } catch (llmErr) {
      recordCall('llm', { ok: false });
      req.log.error({ err: llmErr.message, chatId }, 'Chiamata al modello fallita');

      // RIMBORSO: la richiesta non è stata servita, quindi non si paga.
      const refunded = await reservation.refund();
      reservation = null;

      // L'errore NON viene salvato come messaggio: è un guasto di trasporto,
      // non un turno della conversazione. Prima restava per sempre in
      // cronologia come una bolla rossa (S1-17).
      await Chat.findByIdAndUpdate(chatId, { $inc: { messageCount: 1 }, lastMessageAt: new Date() });

      return res.status(502).json({
        error: 'Il servizio AI non è momentaneamente disponibile. Nessun credito è stato addebitato.',
        userMessage,
        user: {
          credits: refunded ? refunded.credits : req.user.credits,
          subscription: req.user.subscription
        }
      });
    }

    recordCall('llm', { ok: true, costEur: aiResult.cost });

    // 8. Moderazione dell'OUTPUT: ciò che il modello ha prodotto viene guardato
    //    PRIMA di raggiungere l'utente. Se è da bloccare, la risposta viene
    //    sostituita e il credito restituito — l'utente non paga un rifiuto.
    const outbound = await screenAiOutput({ content: aiResult.content, user: req.user, character });
    if (!outbound.safe && reservation) {
      await reservation.refund();
      reservation = null;
    }

    // Se la risposta è simulata non è fatturabile: si restituisce la riserva
    if (aiResult.billable === false && reservation) {
      await reservation.refund();
      reservation = null;
    }

    const aiMessage = await Message.create({
      chatId,
      role: 'assistant',
      content: outbound.content,
      tokens: aiResult.tokens,
      cost: aiResult.cost,
      model: outbound.safe
        ? (aiResult.mode === 'live' ? (process.env.GEMINI_MODEL || 'gemini-2.5-flash') : `simulated:${aiResult.mode}`)
        : 'safety-notice',
      simulated: aiResult.billable === false,
      safetyNotice: !outbound.safe
    });

    // 9. Contatori aggiornati atomicamente su ogni percorso (S1-11)
    await Chat.findByIdAndUpdate(chatId, {
      $inc: { messageCount: 2 },
      lastMessageAt: new Date()
    });
    await Character.findByIdAndUpdate(character._id, { $inc: { usageCount: 1 } });

    // 10. Sintesi della parte più vecchia, se la conversazione è lunga
    await maybeSummarize(chatId);

    const freshUser = await User.findById(userId).select('credits subscription dailyMessageCount');

    res.json({
      userMessage,
      aiMessage,
      user: {
        credits: freshUser.credits,
        subscription: freshUser.subscription
      }
    });
  } catch (error) {
    console.error('Send message error:', error);
    // Qualsiasi errore imprevisto dopo la riserva deve restituirla.
    if (reservation) {
      try { await reservation.refund(); } catch (e) { console.error('Refund failed:', e.message); }
    }
    res.status(500).json({ error: 'Impossibile inviare il messaggio' });
  }
});

/**
 * POST /api/messages/stream - Come sopra, ma trasmette la risposta a pezzi.
 *
 * Stessa contabilità della rotta non-streaming: riserva prima, rimborso in caso
 * di guasto. Cambia solo il modo in cui la risposta raggiunge il client.
 */
router.post('/stream', requireAuth, messageLimiter, validate(sendMessageSchema), async (req, res) => {
  const { chatId, content } = req.body;
  const userId = req.user._id;
  let reservation = null;
  let headersSent = false;

  // Gli eventi viaggiano come Server-Sent Events su una risposta POST.
  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const fail = async (status, message) => {
    if (reservation) {
      try { await reservation.refund(); } catch (e) { console.error('Refund failed:', e.message); }
      reservation = null;
    }
    if (headersSent) {
      send({ error: message });
      return res.end();
    }
    return res.status(status).json({ error: message });
  };

  try {
    await applySubscriptionExpiry(req.user);
    await applyDailyReset(req.user);

    const screening = await screenUserMessage({ content, user: req.user, chatId });
    if (screening.action === 'block') {
      return res.status(400).json({ error: screening.verdict.reason, category: screening.verdict.category });
    }

    const chat = await Chat.findOne({ _id: chatId, userId });
    if (!chat) return res.status(404).json({ error: 'Chat non trovata' });

    const character = await Character.findById(chat.characterId);
    if (!character) return res.status(404).json({ error: 'Character associato non trovato' });

    if (screening.action === 'crisis') {
      const userMessage = await Message.create({ chatId, role: 'user', content });
      const aiMessage = await Message.create({
        chatId, role: 'assistant', content: CRISIS_MESSAGE, model: 'safety-notice', safetyNotice: true
      });
      await Chat.findByIdAndUpdate(chatId, { $inc: { messageCount: 2 }, lastMessageAt: new Date() });
      return res.json({
        userMessage,
        aiMessage,
        safety: { type: 'crisis', resources: CRISIS_RESOURCES },
        user: { credits: req.user.credits, subscription: req.user.subscription }
      });
    }

    reservation = await reserveAllowance(userId, req.user.subscription, 'message');
    if (!reservation) {
      return res.status(402).json({
        error: 'Crediti esauriti o limite giornaliero raggiunto per il tuo piano. Effettua una ricarica o aggiorna il tuo piano.'
      });
    }

    const userMessage = await Message.create({ chatId, role: 'user', content });
    const context = await buildContext(chat, character);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    headersSent = true;
    send({ userMessage });

    // Moderazione dell'output IN CORSA: il testo viene esaminato mentre si
    // accumula, così una risposta vietata smette di essere trasmessa appena si
    // riconosce, invece di comparire per intero sullo schermo e sparire dopo.
    let streamedUnsafe = false;
    let buffer = '';

    let aiResult;
    try {
      aiResult = await generateResponseStream(context, character.name, (delta) => {
        if (streamedUnsafe) return;
        buffer += delta;
        if (moderateText(buffer).severity === 'block') {
          streamedUnsafe = true;
          send({ moderated: true });
          return;
        }
        send({ delta });
      });
    } catch (llmErr) {
      recordCall('llm', { ok: false });
      req.log.error({ err: llmErr.message, chatId, safetyBlocked: !!llmErr.safetyBlocked }, 'Streaming del modello fallito');
      const message = llmErr.safetyBlocked
        ? 'La risposta è stata interrotta dai filtri di sicurezza del modello. Nessun credito è stato addebitato.'
        : 'Il servizio AI non è momentaneamente disponibile. Nessun credito è stato addebitato.';
      return fail(502, message);
    }

    recordCall('llm', { ok: true, costEur: aiResult.cost });

    const outbound = await screenAiOutput({ content: aiResult.content, user: req.user, character });
    if (!outbound.safe && reservation) {
      await reservation.refund();
      reservation = null;
    }

    if (aiResult.billable === false && reservation) {
      await reservation.refund();
      reservation = null;
    }

    const aiMessage = await Message.create({
      chatId,
      role: 'assistant',
      content: outbound.content,
      tokens: aiResult.tokens,
      cost: aiResult.cost,
      model: outbound.safe
        ? (aiResult.mode === 'live' ? (process.env.GEMINI_MODEL || 'gemini-2.5-flash') : `simulated:${aiResult.mode}`)
        : 'safety-notice',
      simulated: aiResult.billable === false,
      safetyNotice: !outbound.safe
    });

    await Chat.findByIdAndUpdate(chatId, { $inc: { messageCount: 2 }, lastMessageAt: new Date() });
    await Character.findByIdAndUpdate(character._id, { $inc: { usageCount: 1 } });
    await maybeSummarize(chatId);

    const freshUser = await User.findById(userId).select('credits subscription');

    send({
      done: true,
      aiMessage,
      // Il client deve rimpiazzare ciò che ha già mostrato con il contenuto
      // definitivo: senza questo segnale resterebbe a schermo il testo parziale.
      moderated: !outbound.safe,
      user: { credits: freshUser.credits, subscription: freshUser.subscription }
    });
    res.end();
  } catch (error) {
    console.error('Stream message error:', error);
    return fail(500, 'Impossibile inviare il messaggio');
  }
});

/**
 * POST /api/messages/regenerate - Rifà l'ultima risposta del personaggio.
 *
 * Rimuove l'ultimo turno dell'assistente e lo rigenera a partire dallo stesso
 * contesto. È una delle azioni che nell'interfaccia di riferimento sono sempre
 * disponibili sul messaggio e qui non esistevano affatto (S3-14).
 */
router.post('/regenerate', requireAuth, messageLimiter, async (req, res) => {
  const { chatId } = req.body;
  const userId = req.user._id;
  let reservation = null;

  try {
    if (!chatId || !/^[0-9a-fA-F]{24}$/.test(chatId)) {
      return res.status(400).json({ error: 'ID Chat non valido' });
    }

    await applySubscriptionExpiry(req.user);
    await applyDailyReset(req.user);

    const chat = await Chat.findOne({ _id: chatId, userId });
    if (!chat) return res.status(404).json({ error: 'Chat non trovata' });

    const character = await Character.findById(chat.characterId);
    if (!character) return res.status(404).json({ error: 'Character associato non trovato' });

    const last = await Message.findOne({ chatId, role: 'assistant' }).sort({ createdAt: -1 });
    if (!last) return res.status(400).json({ error: 'Non c\'è ancora una risposta da rigenerare' });

    // Un avviso di sicurezza non è una risposta del personaggio: rigenerarlo
    // significherebbe permettere di ritentare finché il filtro non cede.
    if (last.safetyNotice) {
      return res.status(400).json({ error: 'Questo messaggio è stato prodotto dalla piattaforma e non può essere rigenerato.' });
    }

    reservation = await reserveAllowance(userId, req.user.subscription, 'message');
    if (!reservation) {
      return res.status(402).json({ error: 'Crediti esauriti o limite giornaliero raggiunto.' });
    }

    // La vecchia risposta esce dal contesto prima di rigenerare, altrimenti il
    // modello la vedrebbe e tenderebbe a ripeterla.
    await Message.findByIdAndDelete(last._id);

    const context = await buildContext(chat, character);

    let aiResult;
    try {
      aiResult = await generateResponse(context, character.name);
    } catch (llmErr) {
      recordCall('llm', { ok: false });
      req.log.error({ err: llmErr.message, chatId }, 'Rigenerazione fallita');

      // La risposta precedente è già stata rimossa: la si ripristina per non
      // lasciare la conversazione monca.
      await Message.create({
        chatId, role: 'assistant', content: last.content,
        tokens: last.tokens, cost: last.cost, model: last.model, simulated: last.simulated
      });
      await reservation.refund();
      reservation = null;
      return res.status(502).json({ error: 'Il servizio AI non è momentaneamente disponibile. Nessun credito è stato addebitato.' });
    }

    recordCall('llm', { ok: true, costEur: aiResult.cost });

    const outbound = await screenAiOutput({ content: aiResult.content, user: req.user, character });
    if (!outbound.safe && reservation) {
      await reservation.refund();
      reservation = null;
    }

    if (aiResult.billable === false && reservation) {
      await reservation.refund();
      reservation = null;
    }

    const aiMessage = await Message.create({
      chatId,
      role: 'assistant',
      content: outbound.content,
      tokens: aiResult.tokens,
      cost: aiResult.cost,
      model: outbound.safe
        ? (aiResult.mode === 'live' ? (process.env.GEMINI_MODEL || 'gemini-2.5-flash') : `simulated:${aiResult.mode}`)
        : 'safety-notice',
      simulated: aiResult.billable === false,
      safetyNotice: !outbound.safe
    });

    await Chat.findByIdAndUpdate(chatId, { lastMessageAt: new Date() });
    const freshUser = await User.findById(userId).select('credits subscription');

    res.json({
      replacedMessageId: last._id,
      aiMessage,
      user: { credits: freshUser.credits, subscription: freshUser.subscription }
    });
  } catch (error) {
    console.error('Regenerate error:', error);
    if (reservation) {
      try { await reservation.refund(); } catch (e) { console.error('Refund failed:', e.message); }
    }
    res.status(500).json({ error: 'Impossibile rigenerare la risposta' });
  }
});

/**
 * DELETE /api/messages/:messageId - Elimina un messaggio dalla propria chat.
 */
router.delete('/item/:messageId', requireAuth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Messaggio non trovato' });

    const chat = await Chat.findOne({ _id: message.chatId, userId: req.user._id });
    if (!chat) return res.status(404).json({ error: 'Messaggio non trovato' });

    await Message.findByIdAndDelete(message._id);
    await Chat.findByIdAndUpdate(chat._id, { $inc: { messageCount: -1 } });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Impossibile eliminare il messaggio' });
  }
});

/**
 * GET /api/messages/:chatId - Storico paginato a cursore.
 *
 * Restituisce gli ULTIMI messaggi in ordine cronologico crescente. La versione
 * precedente ordinava dal più vecchio con un limite fisso di 100: superata
 * quella soglia la conversazione si congelava all'inizio e i messaggi recenti
 * diventavano irraggiungibili (S1-12).
 *
 * Query: ?limit=50&before=<cursore restituito dalla pagina precedente>
 */
router.get('/:chatId', requireAuth, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { before } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const chat = await Chat.findOne({ _id: chatId, userId: req.user._id });
    if (!chat) {
      return res.status(404).json({ error: 'Chat non trovata' });
    }

    const filter = { chatId };
    if (before) {
      const cursorDate = new Date(before);
      if (Number.isNaN(cursorDate.getTime())) {
        return res.status(400).json({ error: 'Cursore non valido' });
      }
      filter.createdAt = { $lt: cursorDate };
    }

    // Si chiede un elemento in più per sapere se esiste altro storico.
    const batch = await Message.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = batch.length > limit;
    const page = hasMore ? batch.slice(0, limit) : batch;
    page.reverse(); // dal più vecchio al più recente, come li legge l'utente

    res.json({
      messages: page,
      hasMore,
      nextCursor: page.length > 0 ? page[0].createdAt : null
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Impossibile recuperare lo storico dei messaggi' });
  }
});

module.exports = router;
