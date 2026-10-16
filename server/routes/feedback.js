const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { isTest, adminEmails } = require('../config/env');
const { sendMail } = require('../services/mailService');
const Feedback = require('../models/Feedback');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const { serverFailure } = require('../services/failure');
const { recordMail } = require('../services/metrics');

const feedbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => (req.user ? `u:${req.user._id}` : `ip:${ipKeyGenerator(req.ip)}`),
  message: { error: 'Hai gia inviato diverse opinioni. Riprova piu tardi.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest() && process.env.FORCE_RATE_LIMIT !== '1'
});

// Destinatario delle notifiche: chi gestisce l'app 
const notifyAddress = () => process.env.FEEDBACK_EMAIL || adminEmails()[0] || null;

const ETICHETTE = {
  review: 'Opinione',
  wants_more: 'VUOLE CONTINUARE',
  bug: 'Segnalazione di un problema'
};

/**
 * POST /api/feedback — lascia un'opinione.
 *
 * Salva sempre, poi prova a notificare. L'ordine conta: se l'invio dell'email
 * fallisse per primo, l'opinione andrebbe persa.
 */
router.post('/', requireAuth, feedbackLimiter, async (req, res) => {
  try {
    const { type, rating, message } = req.body;

    if (!['review', 'wants_more', 'bug'].includes(type)) {
      return res.status(400).json({ error: 'Tipo di feedback non valido' });
    }

    const voto = Number.parseInt(rating, 10);
    const testo = String(message || '').trim().slice(0, 2000);

    // Un'opinione senza voto ne' testo non dice nulla: meglio rifiutarla che
    // riempire la casella di righe vuote. `wants_more` fa eccezione: li' il
    // segnale e' il gesto stesso.
    if (type !== 'wants_more' && !testo && !Number.isInteger(voto)) {
      return res.status(400).json({ error: 'Scrivi qualcosa o lascia un voto.' });
    }

    const chatIds = (await Chat.find({ userId: req.user._id }).select('_id').lean()).map((c) => c._id);
    const messagesSent = await Message.countDocuments({ chatId: { $in: chatIds }, role: 'user' });

    const feedback = await Feedback.create({
      userId: req.user._id,
      type,
      rating: Number.isInteger(voto) && voto >= 1 && voto <= 5 ? voto : null,
      message: testo,
      messagesSent
    });

    /**
     * Notifica. Il fallimento non deve mai far fallire la richiesta: per
     * l'utente l'opinione e' stata consegnata, ed e' vero — e' in database.
     *
     * Ma non deve nemmeno sparire. Prima un destinatario non configurato era
     * un `if` senza ramo `else`: nessun log, nessun contatore, nessun modo di
     * accorgersi che le opinioni si accumulavano in un database che nessuno
     * apriva. Il canale sembrava funzionare da entrambi i lati — l'utente
     * vedeva «grazie», il gestore non vedeva niente e concludeva che nessuno
     * scriveva.
     */
    const to = notifyAddress();

    if (!to) {
      req.log.error(
        { feedbackId: feedback._id },
        'FEEDBACK_EMAIL e ADMIN_EMAILS non configurati: opinione salvata ma nessuno avvisato'
      );
      recordMail(false);
    } else {
      try {
        const esito = await sendMail({
          to,
          subject: `[your-character] ${ETICHETTE[type]} da @${req.user.username}`,
          text: [
            `Tipo:      ${ETICHETTE[type]}`,
            `Utente:    @${req.user.username} (${req.user.email})`,
            `Voto:      ${feedback.rating ? `${feedback.rating}/5` : '—'}`,
            `Messaggi:  ${messagesSent} scritti finora`,
            `Crediti:   ${req.user.credits} rimasti`,
            '',
            testo || '(nessun testo)',
            '',
            `Ricevuto il ${new Date().toLocaleString('it-IT')}`
          ].join('\n')
        });
        recordMail(!!(esito && esito.delivered));

        if (esito && esito.delivered) {
          await Feedback.findByIdAndUpdate(feedback._id, { notified: true });
        } else {
          // `error`, non `warn`: e' il canale con cui si scopre se il prodotto
          // piace. Se smette di funzionare va visto oggi, non al prossimo
          // controllo dei log.
          req.log.error(
            { feedbackId: feedback._id, to, reason: esito && esito.reason },
            'Notifica del feedback NON recapitata'
          );
        }
      } catch (mailErr) {
        recordMail(false);
        req.log.error({ err: mailErr.message, feedbackId: feedback._id }, 'Notifica del feedback non inviata');
      }
    }

    res.status(201).json({
      success: true,
      message: type === 'wants_more'
        ? 'Perfetto, ti scriviamo appena e possibile continuare.'
        : 'Grazie. Leggiamo tutto quello che arriva.'
    });
  } catch (error) {
    serverFailure(req, res, error, 'Impossibile inviare il feedback');
  }
});

/**
 * GET /api/feedback — solo per chi gestisce l'app.
 *
 * L'email puo' perdersi, il database no. Questa e' la fonte autorevole.
 */
router.get('/', requireRole('moderator', 'admin'), async (req, res) => {
  try {
    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 200);
    const filter = {};
    if (['review', 'wants_more', 'bug'].includes(req.query.type)) filter.type = req.query.type;

    const [items, wantsMore, totale, votoMedio] = await Promise.all([
      Feedback.find(filter).sort({ createdAt: -1 }).limit(limit)
        .populate('userId', 'username email credits').lean(),
      Feedback.countDocuments({ type: 'wants_more' }),
      Feedback.countDocuments({}),
      Feedback.aggregate([
        { $match: { rating: { $ne: null } } },
        { $group: { _id: null, media: { $avg: '$rating' }, quanti: { $sum: 1 } } }
      ])
    ]);

    res.json({
      feedback: items,
      riepilogo: {
        totale,
        // Il numero che conta di piu' durante la beta: quante persone hanno
        // finito i crediti e hanno chiesto di continuare.
        voglionoContinuare: wantsMore,
        votoMedio: votoMedio[0] ? Number(votoMedio[0].media.toFixed(2)) : null,
        votiRicevuti: votoMedio[0] ? votoMedio[0].quanti : 0
      }
    });
  } catch (error) {
    serverFailure(req, res, error, 'Impossibile recuperare i feedback');
  }
});

module.exports = router;
