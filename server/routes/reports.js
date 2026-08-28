const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createReportSchema } = require('../utils/validation');
const { reportLimiter } = require('../middleware/rateLimit');
const Report = require('../models/Report');
const Character = require('../models/Character');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const User = require('../models/User');

/**
 * Risolve il proprietario del contenuto segnalato, così chi esamina non deve
 * risalire a mano la catena chat → personaggio → autore.
 * Restituisce `null` anche quando il bersaglio non esiste: una segnalazione su
 * un id inventato non deve entrare in coda.
 */
async function resolveTarget(targetType, targetId) {
  if (targetType === 'character') {
    const character = await Character.findById(targetId).select('createdBy').lean();
    return character ? { exists: true, ownerId: character.createdBy } : { exists: false };
  }
  if (targetType === 'message') {
    const message = await Message.findById(targetId).select('chatId').lean();
    if (!message) return { exists: false };
    const chat = await Chat.findById(message.chatId).select('userId').lean();
    return { exists: true, ownerId: chat ? chat.userId : null };
  }
  const user = await User.findById(targetId).select('_id').lean();
  return user ? { exists: true, ownerId: user._id } : { exists: false };
}

// POST /api/reports - Submit an abuse/content report
router.post('/', requireAuth, reportLimiter, validate(createReportSchema), async (req, res) => {
  try {
    const { targetType, targetId, reason, description } = req.body;
    const reporterId = req.user._id;

    // Prevent self-reporting
    if (targetType === 'user' && targetId === reporterId.toString()) {
      return res.status(400).json({ error: 'Non puoi segnalare te stesso.' });
    }

    const target = await resolveTarget(targetType, targetId);
    if (!target.exists) {
      return res.status(404).json({ error: 'Il contenuto segnalato non esiste.' });
    }

    // Deduplica esplicita PRIMA dell'inserimento.
    //
    // L'indice unico resta ed è ciò che regge le richieste simultanee, ma non
    // può essere l'unica difesa: se per qualsiasi ragione non fosse presente
    // sul database (un ripristino, una migrazione, un ambiente creato a mano)
    // i duplicati tornerebbero a passare in silenzio, senza che nulla fallisca.
    // È la stessa lezione della guardia di avvio scollegata nella FASE B.
    const already = await Report.findOne({
      reporterId, source: 'user', targetType, targetId
    }).select('_id').lean();

    if (already) {
      return res.status(200).json({
        success: true,
        duplicate: true,
        reportId: already._id,
        message: 'Hai già segnalato questo contenuto. La segnalazione è in esame.'
      });
    }

    const report = await Report.create({
      reporterId,
      source: 'user',
      targetType,
      targetId,
      targetOwnerId: target.ownerId || null,
      reason,
      severity: 'user_report',
      description: description || ''
    });

    res.status(201).json({
      success: true,
      reportId: report._id,
      message: 'Segnalazione ricevuta. Il nostro team la esaminerà entro 24-48 ore.'
    });
  } catch (error) {
    // Deduplica (S2-13): l'indice unico impedisce a una stessa persona di
    // aprire più segnalazioni sullo stesso bersaglio. Prima 50 invii identici
    // producevano 50 righe indistinguibili; ora il secondo invio riceve la
    // stessa conferma del primo, perché dal punto di vista di chi segnala il
    // risultato è identico — la segnalazione c'è.
    if (error && error.code === 11000) {
      const existing = await Report.findOne({
        reporterId: req.user._id,
        targetType: req.body.targetType,
        targetId: req.body.targetId,
        source: 'user'
      }).select('_id').lean();

      return res.status(200).json({
        success: true,
        duplicate: true,
        reportId: existing ? existing._id : null,
        message: 'Hai già segnalato questo contenuto. La segnalazione è in esame.'
      });
    }

    console.error('Create report error:', error);
    res.status(500).json({ error: 'Impossibile inviare la segnalazione' });
  }
});

module.exports = router;
