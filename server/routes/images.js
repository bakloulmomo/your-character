const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { imageLimiter } = require('../middleware/rateLimit');
const { validate } = require('../middleware/validate');
const { generateImageSchema } = require('../utils/validation');
const { generateImage } = require('../services/imageService');
const { moderateText } = require('../services/moderationService');
const { recordViolation } = require('../services/moderationLog');
const { recordCall } = require('../services/metrics');
const { applyDailyReset, applySubscriptionExpiry } = require('../utils/time');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const { reserveAllowance, IMAGE_CREDIT_COST } = require('../models/User');
const Transaction = require('../models/Transaction');

// POST /api/images/generate - Generate image in chat (Deducts 10 credits)
router.post('/generate', requireAuth, imageLimiter, validate(generateImageSchema), async (req, res) => {
  let reservation = null;
  try {
    const { chatId, prompt } = req.body;
    const userId = req.user._id;

    // 0. Expire lapsed subscriptions, then roll over daily counters if a new day started
    await applySubscriptionExpiry(req.user);
    await applyDailyReset(req.user);

    // 1. Moderazione del prompt (prima di spendere qualsiasi cosa).
    //    Su un generatore di immagini il prompt È il contenuto: qui il filtro
    //    è l'unico punto di controllo prima che venga prodotto un file.
    const verdict = moderateText(prompt);
    if (verdict.severity === 'block') {
      await recordViolation({
        verdict,
        reporter: req.user,
        targetType: 'user',
        targetId: userId,
        targetOwnerId: userId,
        snippet: prompt,
        context: 'prompt di generazione immagine'
      });
      return res.status(400).json({ error: verdict.reason, category: verdict.category });
    }

    // 2. Proprietà della chat
    const chat = await Chat.findOne({ _id: chatId, userId });
    if (!chat) {
      return res.status(404).json({ error: 'Chat non trovata' });
    }

    // 3. RISERVA prima di generare: controllo e addebito in una sola
    //    operazione atomica, così le richieste simultanee non possono
    //    superare né il saldo né il limite giornaliero.
    reservation = await reserveAllowance(userId, req.user.subscription, 'image');
    if (!reservation) {
      return res.status(402).json({
        error: `Crediti insufficienti per generare un'immagine (richiesti ${IMAGE_CREDIT_COST} crediti) o limite giornaliero raggiunto.`
      });
    }

    // 4. Generazione
    let imageResult;
    try {
      imageResult = await generateImage(prompt);
    } catch (genErr) {
      recordCall('image', { ok: false });
      await reservation.refund();
      reservation = null;
      req.log.error({ err: genErr.message, chatId }, 'Generazione immagine fallita');
      return res.status(502).json({ error: 'Generatore di immagini non disponibile. Nessun credito è stato addebitato.' });
    }

    recordCall('image', { ok: true, costEur: imageResult.cost });

    // 5. Create Assistant Message with Image attachment
    const isBillable = imageResult.billable !== false;
    const message = await Message.create({
      chatId,
      role: 'assistant',
      content: isBillable
        ? `Ecco l'immagine che hai richiesto per: "${prompt}"`
        : `[Immagine simulata — generatore non configurato. Nessun credito addebitato.] Prompt richiesto: "${prompt}"`,
      image: {
        url: imageResult.url,
        prompt,
        generationId: `gen_${Date.now()}`
      },
      cost: imageResult.cost,
      simulated: !isBillable
    });

    // 6. Un'immagine simulata non si paga: si restituisce la riserva.
    if (!isBillable && reservation) {
      await reservation.refund();
      reservation = null;
    }

    // 7. La transazione registra solo un addebito realmente avvenuto.
    if (isBillable && req.user.subscription === 'free') {
      await Transaction.create({
        userId,
        type: 'image_generation',
        credits: -IMAGE_CREDIT_COST,
        // Non è una vendita: i crediti erano già stati pagati al momento
        // dell'acquisto e l'IVA è stata assolta lì.
        grossCents: 0,
        status: 'completed',
        completedAt: new Date()
      });
    }

    await Chat.findByIdAndUpdate(chatId, { $inc: { messageCount: 1 }, lastMessageAt: new Date() });
    const updatedUser = await User.findById(userId);

    res.json({
      message,
      user: {
        credits: updatedUser.credits,
        subscription: updatedUser.subscription
      }
    });
  } catch (error) {
    console.error('Generate image route error:', error);
    if (reservation) {
      try { await reservation.refund(); } catch (e) { console.error('Refund failed:', e.message); }
    }
    res.status(500).json({ error: 'Impossibile generare l\'immagine' });
  }
});

module.exports = router;
