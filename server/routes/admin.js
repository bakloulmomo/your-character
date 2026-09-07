/**
 * Rotte di moderazione (FASE D — S2-2, S2-13).
 *
 * Prima non esisteva alcun modo di ESAMINARE alcunché: le segnalazioni si
 * accumulavano in una collezione che nessuna interfaccia leggeva e i
 * personaggi si pubblicavano da soli. Un catalogo di violazioni che nessuno
 * può vedere non è moderazione, è archiviazione.
 *
 * Tutto è dietro `requireRole`, e il ruolo si concede solo fuori banda con
 * `scripts/grantRole.js`. La promozione automatica via ADMIN_EMAILS è stata
 * rimossa: senza verifica dell'indirizzo, regalava questo pannello a chiunque
 * conoscesse l'email del titolare (vedi `routes/auth.js`).
 */
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { requireRole } = require('../middleware/auth');
const Report = require('../models/Report');
const Character = require('../models/Character');
const User = require('../models/User');
const Message = require('../models/Message');
const { snapshot } = require('../services/metrics');
const { isErrorReportingEnabled } = require('../services/errorReporting');

const staffOnly = requireRole('moderator', 'admin');
const adminOnly = requireRole('admin');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id);

const clampLimit = (value, fallback = 50) => Math.min(Math.max(parseInt(value) || fallback, 1), 100);

// GET /api/admin/overview - Quanto lavoro c'è in coda, in un colpo solo
router.get('/overview', staffOnly, async (req, res) => {
  try {
    const [pendingReports, automaticReports, pendingCharacters, bannedUsers] = await Promise.all([
      Report.countDocuments({ status: 'pending' }),
      Report.countDocuments({ status: 'pending', source: 'automatic' }),
      // Il lavoro in coda è ciò che è PUBBLICATO e non ancora esaminato: da
      // quando la moderazione è successiva, `moderationStatus` dice se un
      // personaggio è visibile, non se qualcuno l'ha guardato — quello lo dice
      // `moderatedAt`.
      Character.countDocuments({ isPublic: true, moderatedAt: null }),
      User.countDocuments({ isBanned: true })
    ]);

    res.json({ pendingReports, automaticReports, pendingCharacters, bannedUsers });
  } catch (error) {
    req.log.error({ err: error.message }, 'overview error:');
    res.status(500).json({ error: 'Impossibile leggere lo stato della moderazione' });
  }
});

/**
 * GET /api/admin/metrics - Spesa e affidabilità del motore AI (FASE E).
 *
 * Due fonti, di natura diversa, dichiarate come tali:
 *  · il COSTO viene aggregato dal database, dove `Message.cost` è scritto a
 *    ogni risposta: è il dato autorevole e sopravvive ai riavvii;
 *  · il TASSO D'ERRORE viene dai contatori in memoria, perché una chiamata
 *    fallita non produce alcun messaggio e quindi non lascia traccia in
 *    nessuna collezione. È vero solo per questo processo, da quando è partito.
 */
router.get('/metrics', staffOnly, async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [aggregate] = await Message.aggregate([
      { $match: { createdAt: { $gte: startOfDay } } },
      {
        $group: {
          _id: null,
          costEur: { $sum: '$cost' },
          messages: { $sum: 1 },
          simulated: { $sum: { $cond: ['$simulated', 1, 0] } },
          safetyNotices: { $sum: { $cond: ['$safetyNotice', 1, 0] } }
        }
      }
    ]);

    res.json({
      persisted: {
        source: 'database (autorevole)',
        day: startOfDay.toISOString().slice(0, 10),
        costEur: Number((aggregate?.costEur || 0).toFixed(4)),
        messages: aggregate?.messages || 0,
        simulated: aggregate?.simulated || 0,
        safetyNotices: aggregate?.safetyNotices || 0
      },
      live: snapshot(),
      errorReporting: isErrorReportingEnabled() ? 'attivo' : 'non configurato'
    });
  } catch (error) {
    req.log.error({ err: error.message }, 'Lettura delle metriche fallita');
    res.status(500).json({ error: 'Impossibile leggere le metriche' });
  }
});

// GET /api/admin/reports?status=pending&source=&limit=&page=
router.get('/reports', staffOnly, async (req, res) => {
  try {
    /**
     * `String()` prima del filtro, come nella galleria pubblica (S5).
     *
     * Con `extended: true`, `?source[$ne]=x` arriva come oggetto e finisce in
     * `filter` come operatore Mongo. Qui chi chiama è già staff, quindi non
     * c'è escalation — ma un moderatore che vede risultati diversi da quelli
     * che ha chiesto è comunque un difetto, e la coda di moderazione è il posto
     * in cui contano.
     */
    const testo = (v) => (v === undefined || v === null ? '' : String(v));
    const status = req.query.status === undefined ? 'pending' : testo(req.query.status);
    const source = testo(req.query.source);
    const targetType = testo(req.query.targetType);
    const limit = clampLimit(req.query.limit);
    const page = Math.max(parseInt(req.query.page) || 1, 1);

    const filter = {};
    if (status && status !== 'all') filter.status = status;
    if (source) filter.source = source;
    if (targetType) filter.targetType = targetType;

    const [reports, total] = await Promise.all([
      Report.find(filter)
        // Le segnalazioni automatiche di blocco per prime, poi le più ripetute,
        // poi le più recenti: la coda si legge dall'alto e ha già senso.
        .sort({ severity: 1, occurrences: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('reporterId', 'username email')
        .populate('targetOwnerId', 'username email isBanned')
        .lean(),
      Report.countDocuments(filter)
    ]);

    res.json({ reports, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    req.log.error({ err: error.message }, 'reports error:');
    res.status(500).json({ error: 'Impossibile recuperare le segnalazioni' });
  }
});

// GET /api/admin/reports/:id/context - Il contenuto segnalato, per decidere
router.get('/reports/:id/context', staffOnly, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID non valido' });

    const report = await Report.findById(req.params.id).lean();
    if (!report) return res.status(404).json({ error: 'Segnalazione non trovata' });

    let target = null;
    if (report.targetType === 'character') {
      target = await Character.findById(report.targetId)
        .select('+systemPrompt')
        .populate('createdBy', 'username email')
        .lean();
    } else if (report.targetType === 'message') {
      target = await Message.findById(report.targetId).lean();
    } else if (report.targetType === 'user') {
      target = await User.findById(report.targetId)
        .select('username email createdAt isBanned banReason subscription')
        .lean();
    }

    res.json({ report, target });
  } catch (error) {
    req.log.error({ err: error.message }, 'report context error:');
    res.status(500).json({ error: 'Impossibile recuperare il contesto della segnalazione' });
  }
});

// PATCH /api/admin/reports/:id - Chiude o archivia una segnalazione
router.patch('/reports/:id', staffOnly, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID non valido' });

    const { status, resolutionNote = '' } = req.body;
    if (!['reviewed', 'actioned', 'dismissed', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Stato non valido' });
    }

    const report = await Report.findByIdAndUpdate(
      req.params.id,
      {
        status,
        resolutionNote: String(resolutionNote).slice(0, 1000),
        reviewedBy: req.user._id,
        reviewedAt: new Date(),
        updatedAt: new Date()
      },
      { new: true }
    ).lean();

    if (!report) return res.status(404).json({ error: 'Segnalazione non trovata' });
    res.json(report);
  } catch (error) {
    req.log.error({ err: error.message }, 'report update error:');
    res.status(500).json({ error: 'Impossibile aggiornare la segnalazione' });
  }
});

/**
 * GET /api/admin/characters?status=da_rivedere — Coda di revisione.
 *
 * La coda ha cambiato significato insieme alla visibilità dei personaggi. Non
 * elenca più ciò che ASPETTA di essere pubblicato — la moderazione preventiva
 * teneva invisibile ogni personaggio pubblico finché qualcuno non lo guardava,
 * e su un'istanza senza moderatori quel qualcuno non esisteva. Elenca ciò che è
 * GIÀ pubblicato e nessuno ha ancora guardato.
 *
 * Il discriminante è `moderatedAt`, non `moderationStatus`: il primo dice se
 * una persona ha deciso, il secondo se il personaggio è visibile. Erano la
 * stessa cosa finché la revisione veniva prima; ora sono due domande diverse.
 *
 * `pending` resta accettato come sinonimo di `da_rivedere`: è ciò che chiedeva
 * l'interfaccia precedente, e una coda che risponde vuota a una richiesta
 * scritta con la parola vecchia è peggio di un nome poco elegante.
 */
router.get('/characters', staffOnly, async (req, res) => {
  try {
    const status = req.query.status === undefined ? 'da_rivedere' : String(req.query.status);
    const limit = clampLimit(req.query.limit, 25);
    const page = Math.max(parseInt(req.query.page) || 1, 1);

    const CODE = {
      // Pubblicati e mai esaminati da una persona. Include i personaggi rimasti
      // `pending` da prima del passaggio alla moderazione successiva.
      da_rivedere: { moderatedAt: null },
      pending: { moderatedAt: null },
      // Esaminati e lasciati online.
      approved: { moderationStatus: 'approved', moderatedAt: { $ne: null } },
      // Rimossi dalla galleria.
      rejected: { moderationStatus: 'rejected' },
      all: {}
    };

    const filter = {
      isPublic: true,
      ...(Object.prototype.hasOwnProperty.call(CODE, status) ? CODE[status] : CODE.da_rivedere)
    };

    const [characters, total] = await Promise.all([
      // Qui `systemPrompt` viene incluso di proposito: è il testo che decide il
      // comportamento del personaggio, ed è esattamente ciò che va esaminato.
      Character.find(filter)
        .select('+systemPrompt')
        .sort({ createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('createdBy', 'username email')
        .lean(),
      Character.countDocuments(filter)
    ]);

    res.json({ characters, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    req.log.error({ err: error.message }, 'characters error:');
    res.status(500).json({ error: 'Impossibile recuperare la coda di revisione' });
  }
});

// PATCH /api/admin/characters/:id - Approva o respinge un personaggio pubblico
router.patch('/characters/:id', staffOnly, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID non valido' });

    const { moderationStatus, moderationReason = '' } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(moderationStatus)) {
      return res.status(400).json({ error: 'Stato di moderazione non valido' });
    }

    // Un rifiuto senza motivazione non è una decisione comunicabile all'autore.
    if (moderationStatus === 'rejected' && !String(moderationReason).trim()) {
      return res.status(400).json({ error: 'Per respingere un personaggio serve una motivazione.' });
    }

    const character = await Character.findByIdAndUpdate(
      req.params.id,
      {
        moderationStatus,
        moderationReason: String(moderationReason).slice(0, 500),
        moderatedBy: req.user._id,
        moderatedAt: new Date()
      },
      { new: true }
    ).lean();

    if (!character) return res.status(404).json({ error: 'Character non trovato' });

    const { systemPrompt, ...safe } = character;
    res.json(safe);
  } catch (error) {
    req.log.error({ err: error.message }, 'character moderation error:');
    res.status(500).json({ error: 'Impossibile aggiornare lo stato del personaggio' });
  }
});

// POST /api/admin/users/:id/ban - Sospensione di un account
router.post('/users/:id/ban', adminOnly, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID non valido' });

    const { reason, days } = req.body;
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'La sospensione richiede una motivazione.' });
    }
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ error: 'Non puoi sospendere il tuo stesso account.' });
    }

    const expiresAt = days ? new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000) : null;

    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        isBanned: true,
        banReason: String(reason).slice(0, 500),
        banExpiresAt: expiresAt,
        // Le sessioni aperte vanno chiuse subito: un account sospeso che
        // continua a chattare col token già emesso non è sospeso.
        $inc: { tokenVersion: 1 }
      },
      { new: true }
    ).select('username email isBanned banReason banExpiresAt').lean();

    if (!user) return res.status(404).json({ error: 'Utente non trovato' });
    res.json(user);
  } catch (error) {
    req.log.error({ err: error.message }, 'ban error:');
    res.status(500).json({ error: 'Impossibile sospendere l\'account' });
  }
});

// POST /api/admin/users/:id/unban
router.post('/users/:id/unban', adminOnly, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID non valido' });

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isBanned: false, banReason: null, banExpiresAt: null },
      { new: true }
    ).select('username email isBanned').lean();

    if (!user) return res.status(404).json({ error: 'Utente non trovato' });
    res.json(user);
  } catch (error) {
    req.log.error({ err: error.message }, 'unban error:');
    res.status(500).json({ error: 'Impossibile riattivare l\'account' });
  }
});

module.exports = router;
