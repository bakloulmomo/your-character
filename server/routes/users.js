const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { exportLimiter } = require('../middleware/rateLimit');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Character = require('../models/Character');
const Transaction = require('../models/Transaction');
const Report = require('../models/Report');
const User = require('../models/User');
const { serverFailure } = require('../services/failure');

const SYSTEM_ACCOUNT_EMAIL = 'system@your-character.app';

/**
 * Account di sistema a cui vengono riassegnati i personaggi pubblici quando il
 * creatore cancella il proprio account.
 */
async function getSystemUser() {
  let systemUser = await User.findOne({ email: SYSTEM_ACCOUNT_EMAIL });
  if (!systemUser) {
    systemUser = await User.create({
      email: SYSTEM_ACCOUNT_EMAIL,
      username: 'your_character',
      authProvider: 'local',
      credits: 0
    });
  }
  return systemUser;
}

// GET /api/users/me - Retrieve authenticated user profile
router.get('/me', requireAuth, async (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      clerkId: req.user.clerkId,
      email: req.user.email,
      username: req.user.username,
      avatar: req.user.avatar,
      credits: req.user.credits,
      subscription: req.user.subscription,
      subscriptionExpiresAt: req.user.subscriptionExpiresAt,
      dailyMessageCount: req.user.dailyMessageCount,
      dailyImageCount: req.user.dailyImageCount,
      role: req.user.role || 'user',
      isAdult: req.user.isAdult(),
      nsfwEnabled: req.user.nsfwEnabled === true,
      cookieConsent: req.user.cookieConsent || null,
      billingCountry: req.user.billingCountry || null,
      gdprConsented: req.user.gdprConsented,
      createdAt: req.user.createdAt
    }
  });
});

/**
 * PATCH /api/users/me/preferences (FASE D — S2-3, S2-6).
 *
 * Due preferenze che prima non avevano dove vivere:
 *  · i contenuti per adulti, che il server non può dedurre dal browser;
 *  · il consenso ai cookie, che stava solo nel localStorage — quindi non era
 *    dimostrabile, si perdeva a ogni cambio di dispositivo e nessuno lo leggeva.
 */
router.patch('/me/preferences', requireAuth, async (req, res) => {
  try {
    const updates = {};

    if (typeof req.body.nsfwEnabled === 'boolean') {
      // La preferenza da sola non apre nulla: l'età dichiarata deve reggerla.
      // Senza questo controllo l'age gate sarebbe una casella da spuntare.
      if (req.body.nsfwEnabled && !req.user.isAdult()) {
        return res.status(403).json({
          error: 'Per attivare i contenuti per adulti serve una data di nascita che ti renda maggiorenne.',
          requiresAgeVerification: true
        });
      }
      updates.nsfwEnabled = req.body.nsfwEnabled;
    }

    if (req.body.cookieConsent && typeof req.body.cookieConsent === 'object') {
      updates.cookieConsent = {
        functional: req.body.cookieConsent.functional === true,
        version: String(req.body.cookieConsent.version || '').slice(0, 32) || null,
        updatedAt: new Date()
      };
    }

    if (typeof req.body.billingCountry === 'string' && /^[A-Za-z]{2}$/.test(req.body.billingCountry)) {
      updates.billingCountry = req.body.billingCountry.toUpperCase();
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nessuna preferenza valida da aggiornare' });
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true });

    res.json({
      nsfwEnabled: user.nsfwEnabled,
      isAdult: user.isAdult(),
      cookieConsent: user.cookieConsent,
      billingCountry: user.billingCountry
    });
  } catch (error) {
    serverFailure(req, res, error, 'Impossibile aggiornare le preferenze');
  }
});

// GET /api/users/me/credits - Retrieve current user credits balance
router.get('/me/credits', requireAuth, async (req, res) => {
  res.json({
    credits: req.user.credits,
    subscription: req.user.subscription,
    canSendMessage: req.user.canSendMessage(),
    canGenerateImage: req.user.canGenerateImage()
  });
});

// GET /api/users/me/export - GDPR Data Export endpoint (ZIP / JSON export)
router.get('/me/export', requireAuth, exportLimiter, async (req, res) => {
  try {
    const userId = req.user._id;

    const [userChats, userCharacters, userTransactions] = await Promise.all([
      Chat.find({ userId }).lean(),
      Character.find({ createdBy: userId }).select('+systemPrompt').lean(),
      Transaction.find({ userId }).lean()
    ]);

    const chatIds = userChats.map(c => c._id);
    const userMessages = await Message.find({ chatId: { $in: chatIds } }).lean();

    // Le segnalazioni inviate e i consensi registrati sono dati personali come
    // gli altri: un export che li omette non soddisfa l'art. 20.
    const userReports = await Report.find({ reporterId: userId }).lean();

    const exportData = {
      exportTimestamp: new Date().toISOString(),
      userProfile: {
        id: req.user._id,
        email: req.user.email,
        username: req.user.username,
        birthdate: req.user.birthdate,
        credits: req.user.credits,
        subscription: req.user.subscription,
        role: req.user.role,
        nsfwEnabled: req.user.nsfwEnabled,
        billingCountry: req.user.billingCountry,
        createdAt: req.user.createdAt
      },
      consents: {
        gdprConsented: req.user.gdprConsented,
        gdprConsentedAt: req.user.gdprConsentedAt,
        cookieConsent: req.user.cookieConsent
      },
      charactersCreated: userCharacters,
      chats: userChats,
      messages: userMessages,
      transactions: userTransactions,
      reportsSubmitted: userReports
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="your-character-gdpr-export-${userId}.json"`);
    res.json(exportData);
  } catch (error) {
    serverFailure(req, res, error, 'Errore durante l\'esportazione dei dati GDPR');
  }
});

// DELETE /api/users/me - GDPR Right to be Forgotten (Full Account Deletion)
router.delete('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    // Retrieve user chats to clean associated messages and sessions
    const userChats = await Chat.find({ userId }).select('_id characterId').lean();
    const chatIds = userChats.map(c => c._id);

    /**
     * Le conversazioni che spariscono smettono di essere contate.
     *
     * `chatCount` è il numero mostrato in galleria come «N conversazioni». Ogni
     * chat aperta lo incrementa e nessun percorso lo decrementava: cancellando
     * un account con cinquanta conversazioni, cinquanta conversazioni
     * inesistenti restavano contate — e sui personaggi PUBBLICI, cioè quelli di
     * altre persone, che qui vengono deliberatamente conservati. Il contatore
     * poteva quindi solo allontanarsi dalla realtà.
     */
    const perCharacter = new Map();
    for (const chat of userChats) {
      if (!chat.characterId) continue;
      const key = chat.characterId.toString();
      perCharacter.set(key, (perCharacter.get(key) || 0) + 1);
    }
    await Promise.all(
      [...perCharacter].map(([characterId, count]) =>
        Character.updateOne(
          { _id: characterId, chatCount: { $gte: count } },
          { $inc: { chatCount: -count } }
        )
      )
    );

    // I personaggi PUBBLICI restano disponibili alla community, ma non possono
    // puntare a un autore inesistente: vengono riassegnati a un account di
    // sistema. Prima restavano orfani, con `createdBy` verso un utente
    // cancellato e la scheda del personaggio irrimediabilmente rotta (S2-11).
    const publicCount = await Character.countDocuments({ createdBy: userId, isPublic: true });
    if (publicCount > 0) {
      const systemUser = await getSystemUser();
      await Character.updateMany(
        { createdBy: userId, isPublic: true },
        { createdBy: systemUser._id }
      );
    }

    /**
     * Le TRANSAZIONI non vengono cancellate.
     *
     * L'informativa privacy dichiara che «le transazioni sono conservate per
     * l'obbligo fiscale decennale», ma il codice eseguiva `deleteMany`: faceva
     * l'opposto di cio' che il documento pubblicato prometteva, distruggeva
     * registri che l'art. 2220 c.c. obbliga a conservare dieci anni, e bucava
     * la numerazione progressiva delle ricevute gia' emesse.
     *
     * Vengono invece marcate: l'account e' sparito, la riga contabile resta.
     * L'identita' fiscale necessaria e' gia' nell'istantanea salvata al momento
     * del pagamento, quindi la ricevuta resta emettibile senza dipendere da un
     * account che non c'e' piu'. Il GDPR lo consente quando esiste un obbligo
     * di legge (art. 17.3.b).
     */
    await Transaction.updateMany(
      { userId, accountDeletedAt: null },
      { accountDeletedAt: new Date() }
    );

    await Promise.all([
      Message.deleteMany({ chatId: { $in: chatIds } }),
      Chat.deleteMany({ userId }),
      Character.deleteMany({ createdBy: userId, isPublic: false }),
      Report.deleteMany({ reporterId: userId }),
      User.findByIdAndDelete(userId)
    ]);

    res.json({
      success: true,
      message: 'Account e dati personali eliminati con successo in conformità alle norme GDPR.'
    });
  } catch (error) {
    serverFailure(req, res, error, 'Errore durante l\'eliminazione dell\'account');
  }
});

module.exports = router;
