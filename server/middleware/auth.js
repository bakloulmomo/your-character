const jwt = require('jsonwebtoken');
const { getAuth } = require('@clerk/express');
const User = require('../models/User');
const { jwtSecret, isTest, welcomeCredits } = require('../config/env');

/**
 * Estrae il token dalla richiesta: header Authorization o cookie di sessione.
 */
const extractToken = (req) => {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return req.headers.authorization.split(' ')[1];
  }
  if (req.headers.cookie) {
    const match = req.headers.cookie.match(/yc_token=([^;]+)/);
    if (match) return match[1];
  }
  return null;
};

/**
 * Risolve l'utente della richiesta senza imporre l'autenticazione.
 * Restituisce null se la richiesta è anonima o se la sessione è stata revocata.
 */
const resolveUser = async (req) => {
  // 1. JWT nativo (header o cookie)
  const token = extractToken(req);
  if (token) {
    try {
      const decoded = jwt.verify(token, jwtSecret());
      if (decoded && decoded.id) {
        const user = await User.findById(decoded.id);
        // La versione nel token deve corrispondere a quella dell'account:
        // dopo un logout il vecchio token non vale più nulla.
        if (user && (decoded.tv || 0) === (user.tokenVersion || 0)) {
          return user;
        }
      }
    } catch (jwtErr) {
      // Token assente, scaduto o non valido: si prosegue come anonimo.
    }
  }

  // 2. Contesto Clerk, quando presente
  let clerkId = null;
  try {
    const auth = getAuth(req);
    if (auth && auth.userId) clerkId = auth.userId;
  } catch (e) {
    // Contesto Clerk non disponibile.
  }

  if (clerkId) {
    let user = await User.findOne({ clerkId });
    if (!user) {
      user = await User.create({
        clerkId,
        authProvider: 'clerk',
        email: `${clerkId}@user.your-character.app`,
        username: `user_${clerkId.slice(-6)}`,
        credits: welcomeCredits()
      });
    }
    return user;
  }

  // 3. Header di mock — SOLO in ambiente di test.
  // Non deve mai essere attivo altrove: permetterebbe di impersonare
  // qualunque account con una semplice intestazione HTTP.
  if (isTest()) {
    const mockClerkHeader = req.headers['x-mock-clerk-id'];
    if (mockClerkHeader) {
      let user = await User.findOne({ clerkId: mockClerkHeader });
      if (!user) {
        user = await User.create({
          clerkId: mockClerkHeader,
          authProvider: 'clerk',
          email: req.headers['x-mock-email'] || `${mockClerkHeader}@example.com`,
          username: req.headers['x-mock-username'] || mockClerkHeader,
          credits: welcomeCredits()
        });
      }
      return user;
    }
  }

  return null;
};

/**
 * Autenticazione opzionale: popola req.user quando disponibile e lascia
 * comunque passare la richiesta. Serve alle rotte pubbliche che devono però
 * sapere chi sta guardando (es. mostrare al proprietario i suoi personaggi privati).
 */
const attachUser = async (req, res, next) => {
  try {
    const user = await resolveUser(req);
    req.user = user && !user.isBanned ? user : null;
    next();
  } catch (error) {
    console.error('attachUser error:', error);
    req.user = null;
    next();
  }
};

/**
 * Autenticazione obbligatoria.
 */
const requireAuth = async (req, res, next) => {
  try {
    const dbUser = await resolveUser(req);

    if (!dbUser) {
      return res.status(401).json({ error: 'Autenticazione richiesta' });
    }

    if (dbUser.isBanned) {
      return res.status(403).json({
        error: 'Account sospeso',
        reason: dbUser.banReason || 'Violazione dei termini di servizio',
        expiresAt: dbUser.banExpiresAt
      });
    }

    req.user = dbUser;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Errore durante l\'autenticazione' });
  }
};

/**
 * Autorizzazione per ruolo (FASE D — S2-13).
 *
 * La coda di revisione e le azioni di moderazione hanno bisogno di un confine:
 * senza, «interfaccia di amministrazione» significherebbe endpoint che
 * chiunque, autenticandosi, può chiamare. Restituisce 404 e non 403 perché
 * l'esistenza stessa del pannello non è un'informazione da regalare.
 */
const requireRole = (...roles) => async (req, res, next) => {
  await requireAuth(req, res, () => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(404).json({ error: 'Risorsa non trovata' });
    }
    next();
  });
};

module.exports = { requireAuth, attachUser, resolveUser, requireRole };
