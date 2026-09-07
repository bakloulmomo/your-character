const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { sendMessageSchema, isValidObjectId } = require('../utils/validation');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Character = require('../models/Character');
const User = require('../models/User');
const { reserveAllowance } = require('../models/User');
const { screenUserMessage, screenAiOutput, CRISIS_MESSAGE, CRISIS_RESOURCES } = require('../services/moderationGuards');
const { moderateText } = require('../services/moderationService');
const { buildContext, maybeSummarize } = require('../services/contextManager');
const { generateResponse, generateResponseStream } = require('../services/geminiService');
const { betaDailyMessageCap } = require('../config/env');
const { applyDailyReset, applySubscriptionExpiry } = require('../utils/time');
const { messageLimiter } = require('../middleware/rateLimit');
const { recordCall } = require('../services/metrics');
const { serverFailure, warnFailure, logFailure } = require('../services/failure');

/**
 * Rifiuto della riserva, spiegato.
 *
 * «Non puoi mandare questo messaggio» ha tre cause distinte, e all'utente
 * servono tre azioni distinte: ricaricare, aspettare domani, o niente. Un
 * messaggio unico le confonderebbe tutte in un vicolo cieco.
 */
const allowanceDenied = (reservation) => {
  if (reservation && reservation.blockedBy === 'dailyCap') {
    return {
      status: 429,
      body: {
        error: `Hai raggiunto il limite di ${reservation.cap} messaggi al giorno previsto durante la beta. Il conteggio riparte a mezzanotte. I tuoi crediti restano dove sono.`,
        reason: 'daily_cap',
        cap: reservation.cap
      }
    };
  }
  return {
    status: 402,
    body: {
      error: 'Crediti esauriti o limite del tuo piano raggiunto.',
      reason: 'no_credits'
    }
  };
};

/**
 * Guasto del modello, spiegato.
 *
 * La quota giornaliera del piano gratuito e' condivisa da tutta l'istanza:
 * quando finisce non e' un guasto ne' una colpa dell'utente, ed e' importante
 * dirlo — sapere che si riprova domani e' un'informazione, «servizio non
 * disponibile» non lo e'.
 */
const llmFailure = (err) => (
  err && err.quotaExceeded
    ? { status: 503, error: 'Abbiamo raggiunto il limite di messaggi disponibili per oggi su questa beta. Riprova domani: nessun credito e stato addebitato.', reason: 'quota_exceeded' }
    : err && err.safetyBlocked
      ? { status: 502, error: 'La risposta e stata interrotta dai filtri di sicurezza del modello. Nessun credito e stato addebitato.', reason: 'safety' }
      : { status: 502, error: 'Il servizio AI non e momentaneamente disponibile. Nessun credito e stato addebitato.', reason: 'llm_error' }
);

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

    // `+systemPrompt`: il campo è `select: false` sul modello e serve qui,
    // perché è ciò che definisce il comportamento del personaggio.
    const character = await Character.findById(chat.characterId).select('+systemPrompt');
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
    if (!reservation || reservation.blockedBy) {
      const denied = allowanceDenied(reservation);
      reservation = null;
      return res.status(denied.status).json(denied.body);
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
      const failure = llmFailure(llmErr);
      req.log.error({ err: llmErr.message, chatId, reason: failure.reason }, 'Chiamata al modello fallita');

      // RIMBORSO: la richiesta non è stata servita, quindi non si paga.
      const refunded = await reservation.refund();
      reservation = null;

      // L'errore NON viene salvato come messaggio: è un guasto di trasporto,
      // non un turno della conversazione. Prima restava per sempre in
      // cronologia come una bolla rossa (S1-17).
      await Chat.findByIdAndUpdate(chatId, { $inc: { messageCount: 1 }, lastMessageAt: new Date() });

      return res.status(failure.status).json({
        error: failure.error,
        reason: failure.reason,
        userMessage,
        user: {
          credits: refunded ? refunded.credits : req.user.credits,
          subscription: req.user.subscription
        }
      });
    }

    /**
     * Il taglio per sicurezza si registra, non si nasconde.
     *
     * L'utente riceve la parte già generata e non vede alcun errore — è la
     * scelta giusta per lui — ma un personaggio che porta il modello al limite
     * a ogni turno è un'informazione che deve arrivare a chi modera, non
     * sparire nel silenzio di una degradazione riuscita.
     */
    if (aiResult.truncatedBySafety) {
      req.log.warn(
        { chatId, characterId: String(character._id), reason: aiResult.truncatedBySafety, lunghezza: aiResult.content.length },
        'Risposta troncata dai filtri del modello: consegnata la parte già generata'
      );
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
    // Qualsiasi errore imprevisto dopo la riserva deve restituirla.
    if (reservation) {
      try { await reservation.refund(); } catch (e) { warnFailure(req, e, 'Rimborso dei crediti non riuscito'); }
    }
    serverFailure(req, res, error, 'Impossibile inviare il messaggio');
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
      try { await reservation.refund(); } catch (e) { warnFailure(req, e, 'Rimborso dei crediti non riuscito'); }
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

    // `+systemPrompt`: il campo è `select: false` sul modello e serve qui,
    // perché è ciò che definisce il comportamento del personaggio.
    const character = await Character.findById(chat.characterId).select('+systemPrompt');
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
    if (!reservation || reservation.blockedBy) {
      const denied = allowanceDenied(reservation);
      reservation = null;
      return res.status(denied.status).json(denied.body);
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

    /**
     * Moderazione dello streaming a FINESTRA, non sul buffer intero (S9).
     *
     * Prima ogni frammento faceva `moderateText(buffer)` sul buffer CRESCENTE.
     * `moderateText` normalizza fino a ottomila caratteri e poi applica circa
     * duecentocinquanta espressioni regolari con quantificatori e classi
     * `[\W_]{0,2}` per ciascun carattere del termine. Una risposta da mille
     * token arriva in due-trecento frammenti, quindi si parlava di decine di
     * migliaia di esecuzioni di quelle regex su stringhe che crescono fino a
     * quattromila caratteri — tutto sull'event loop, che è uno solo.
     *
     * Su un dyno gratuito da un decimo di CPU bastavano poche conversazioni
     * simultanee per bloccarlo, e quando l'event loop è bloccato non risponde
     * NIENTE: né il login, né il webhook di Stripe. Il limite di venti messaggi
     * al minuto per utente non protegge, perché il costo non sta nel numero di
     * richieste ma nella durata di ognuna.
     *
     * Basta guardare la CODA. Un termine vietato è lungo al massimo qualche
     * decina di caratteri anche scritto con separatori: una finestra di
     * cinquecento caratteri lo contiene sempre per intero, e la sovrapposizione
     * fra una finestra e la successiva impedisce che un termine a cavallo di
     * due frammenti sfugga. Il controllo completo sul testo intero resta
     * comunque, una volta sola, alla fine — è `screenAiOutput` più sotto, che è
     * quello che decide davvero.
     */
    const FINESTRA = 500;
    /** Ogni quanti caratteri nuovi vale la pena riesaminare la coda. */
    const PASSO = 120;
    let esaminatiFinoA = 0;

    let aiResult;
    try {
      aiResult = await generateResponseStream(context, character.name, (delta) => {
        if (streamedUnsafe) return;
        buffer += delta;

        // Si riesamina ogni PASSO caratteri nuovi, e sempre al primo
        // frammento — così una risposta breve e vietata viene fermata prima di
        // arrivare a schermo, non solo dal controllo finale.
        if (esaminatiFinoA === 0 || buffer.length - esaminatiFinoA >= PASSO) {
          const coda = buffer.slice(Math.max(0, buffer.length - FINESTRA));
          esaminatiFinoA = buffer.length;
          if (moderateText(coda).severity === 'block') {
            streamedUnsafe = true;
            send({ moderated: true });
            return;
          }
        }
        send({ delta });
      });
    } catch (llmErr) {
      recordCall('llm', { ok: false });
      const failure = llmFailure(llmErr);
      req.log.error({ err: llmErr.message, chatId, reason: failure.reason }, 'Streaming del modello fallito');

      /**
       * Il messaggio dell'utente è già stato salvato: la conversazione deve
       * saperlo.
       *
       * La rotta non-streaming faceva questo aggiornamento nel proprio ramo di
       * guasto; qui mancava. E siccome il client invia SEMPRE da questa rotta,
       * era l'unico percorso che gli utenti attraversano davvero: a ogni
       * guasto del modello il messaggio finiva in archivio mentre
       * `messageCount` restava indietro di uno e `lastMessageAt` non si
       * spostava. Conseguenze visibili: il conteggio sulla scheda del
       * personaggio scendeva sotto il numero reale di messaggi, e la
       * conversazione non risaliva in cima alla cronologia — restava
       * raggruppata sotto «Ieri» o «Ultimi 7 giorni» pur avendo appena
       * ricevuto un messaggio.
       */
      await Chat.findByIdAndUpdate(chatId, { $inc: { messageCount: 1 }, lastMessageAt: new Date() });

      return fail(failure.status, failure.error);
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
    /**
     * Su questa rotta le intestazioni possono essere già partite: `fail()` sa
     * scegliere fra un corpo JSON e un evento SSE, quindi resta lui a
     * rispondere. Ciò che mancava era la REGISTRAZIONE — un guasto in mezzo a
     * uno streaming è il più difficile da diagnosticare e non lasciava traccia
     * correlata né raggiungeva la raccolta errori.
     */
    logFailure(req, error, 'Impossibile inviare il messaggio (streaming)');
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
  /**
   * La risposta rimossa, finché non è stata sostituita.
   *
   * Rigenerare cancella il vecchio turno PRIMA di chiamare il modello, perché
   * altrimenti il modello lo rileggerebbe nel contesto e tenderebbe a
   * ripeterlo. Fra la cancellazione e la creazione della nuova risposta ci sono
   * però cinque operazioni che possono fallire — la ricostruzione del contesto,
   * la moderazione dell'output, la scrittura stessa — e solo il guasto del
   * modello aveva un ripristino. Su tutti gli altri percorsi il turno spariva
   * dalla conversazione in modo definitivo: nessun messaggio d'errore lo dice,
   * e non esiste un annulla.
   */
  let removedAssistantTurn = null;

  try {
    if (!chatId || !/^[0-9a-fA-F]{24}$/.test(chatId)) {
      return res.status(400).json({ error: 'ID Chat non valido' });
    }

    await applySubscriptionExpiry(req.user);
    await applyDailyReset(req.user);

    const chat = await Chat.findOne({ _id: chatId, userId });
    if (!chat) return res.status(404).json({ error: 'Chat non trovata' });

    // `+systemPrompt`: il campo è `select: false` sul modello e serve qui,
    // perché è ciò che definisce il comportamento del personaggio.
    const character = await Character.findById(chat.characterId).select('+systemPrompt');
    if (!character) return res.status(404).json({ error: 'Character associato non trovato' });

    const last = await Message.findOne({ chatId, role: 'assistant' }).sort({ createdAt: -1 });
    if (!last) return res.status(400).json({ error: 'Non c\'è ancora una risposta da rigenerare' });

    // Un avviso di sicurezza non è una risposta del personaggio: rigenerarlo
    // significherebbe permettere di ritentare finché il filtro non cede.
    if (last.safetyNotice) {
      return res.status(400).json({ error: 'Questo messaggio è stato prodotto dalla piattaforma e non può essere rigenerato.' });
    }

    reservation = await reserveAllowance(userId, req.user.subscription, 'message');
    if (!reservation || reservation.blockedBy) {
      const denied = allowanceDenied(reservation);
      reservation = null;
      return res.status(denied.status).json(denied.body);
    }

    // La vecchia risposta esce dal contesto prima di rigenerare, altrimenti il
    // modello la vedrebbe e tenderebbe a ripeterla.
    await Message.findByIdAndDelete(last._id);
    removedAssistantTurn = last;

    const context = await buildContext(chat, character);

    let aiResult;
    try {
      aiResult = await generateResponse(context, character.name);
    } catch (llmErr) {
      recordCall('llm', { ok: false });
      const failure = llmFailure(llmErr);
      req.log.error({ err: llmErr.message, chatId, reason: failure.reason }, 'Rigenerazione fallita');

      // La risposta precedente è già stata rimossa: la si ripristina per non
      // lasciare la conversazione monca.
      await restoreRemovedTurn();
      await reservation.refund();
      reservation = null;
      return res.status(failure.status).json({ error: failure.error, reason: failure.reason });
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

    // Sostituita: da qui in poi non c'è più nulla da ripristinare.
    removedAssistantTurn = null;

    await Chat.findByIdAndUpdate(chatId, { lastMessageAt: new Date() });
    const freshUser = await User.findById(userId).select('credits subscription');

    res.json({
      replacedMessageId: last._id,
      aiMessage,
      user: { credits: freshUser.credits, subscription: freshUser.subscription }
    });
  } catch (error) {
    // Prima il rimborso, poi il ripristino: sono indipendenti, e se il secondo
    // fallisce non deve impedire il primo.
    if (reservation) {
      try { await reservation.refund(); } catch (e) { warnFailure(req, e, 'Rimborso dei crediti non riuscito'); }
    }
    try {
      await restoreRemovedTurn();
    } catch (e) {
      warnFailure(req, e, 'Ripristino della risposta rimossa non riuscito: la conversazione resta monca');
    }
    serverFailure(req, res, error, 'Impossibile rigenerare la risposta');
  }

  /**
   * Rimette la risposta rimossa esattamente com'era.
   *
   * Idempotente: chiamarla due volte non duplica nulla, perché azzera il
   * riferimento. Serve perché il ramo di guasto del modello ripristina già per
   * conto suo, e il `catch` esterno la richiama comunque.
   */
  async function restoreRemovedTurn() {
    if (!removedAssistantTurn) return;
    const turn = removedAssistantTurn;
    removedAssistantTurn = null;
    await Message.create({
      chatId,
      role: 'assistant',
      content: turn.content,
      tokens: turn.tokens,
      cost: turn.cost,
      model: turn.model,
      simulated: turn.simulated,
      safetyNotice: turn.safetyNotice
    });
  }
});

/**
 * DELETE /api/messages/:messageId - Elimina un messaggio dalla propria chat.
 */
router.delete('/item/:messageId', requireAuth, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.messageId)) {
      return res.status(400).json({ error: 'Identificativo non valido' });
    }

    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Messaggio non trovato' });

    const chat = await Chat.findOne({ _id: message.chatId, userId: req.user._id });
    if (!chat) return res.status(404).json({ error: 'Messaggio non trovato' });

    await Message.findByIdAndDelete(message._id);

    /**
     * Eliminare un messaggio deve toglierlo dalla CONVERSAZIONE, non solo dalla
     * vista.
     *
     * Prima qui c'era una riga sola: `$inc: { messageCount: -1 }`. Il messaggio
     * spariva dallo schermo e dalla collezione, e tutto il resto restava
     * indietro:
     *
     *  · `conversationSummary` continuava a contenerlo. È il riassunto che
     *    viene reinserito nel contesto di OGNI turno successivo: il personaggio
     *    seguitava a ricordare — e a citare — una cosa che l'utente aveva
     *    cancellato. Per una conversazione privata questa non è un'imprecisione,
     *    è il contrario di quello che la cancellazione promette.
     *  · `lastMessageAt` restava all'istante del messaggio eliminato, quindi la
     *    cronologia nella barra laterale continuava a ordinare la conversazione
     *    come se l'ultimo scambio fosse ancora lì.
     *  · `messageCount` si limitava a scendere di uno, e da un valore già
     *    disallineato poteva finire sotto zero senza che nulla lo fermasse.
     *
     * I due contatori si RICALCOLANO dai messaggi rimasti invece di essere
     * corretti a incrementi: la collezione è la fonte di verità, e ricalcolare
     * costa una query indicizzata.
     */
    const [rimasti, ultimo] = await Promise.all([
      Message.countDocuments({ chatId: chat._id }),
      Message.findOne({ chatId: chat._id }).sort({ createdAt: -1, _id: -1 }).select('createdAt').lean()
    ]);

    /**
     * Il riassunto viene azzerato, non riscritto.
     *
     * Riscriverlo vorrebbe dire una chiamata al modello a ogni eliminazione:
     * lenta, a pagamento, e su un contenuto che l'utente ha appena chiesto di
     * far sparire. Azzerandolo la memoria lunga si ricostruisce da sola al
     * prossimo superamento della soglia, a partire dai soli messaggi rimasti —
     * costa un po' di contesto sulle conversazioni molto lunghe, e in cambio la
     * cancellazione è vera.
     */
    await Chat.findByIdAndUpdate(chat._id, {
      messageCount: rimasti,
      lastMessageAt: ultimo ? ultimo.createdAt : chat.createdAt,
      conversationSummary: ''
    });

    res.json({
      success: true,
      chat: {
        _id: chat._id,
        messageCount: rimasti,
        lastMessageAt: ultimo ? ultimo.createdAt : chat.createdAt
      }
    });
  } catch (error) {
    serverFailure(req, res, error, 'Impossibile eliminare il messaggio');
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
    if (!isValidObjectId(chatId)) {
      return res.status(400).json({ error: 'Identificativo non valido' });
    }

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
    serverFailure(req, res, error, 'Impossibile recuperare lo storico dei messaggi');
  }
});

module.exports = router;
