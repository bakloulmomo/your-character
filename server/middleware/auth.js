const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { jwtSecret, isTest, welcomeCredits } = require('../config/env');
const { applyBanExpiry } = require('../utils/time');
const { serverFailure, warnFailure } = require('../services/failure');

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
          // Una sospensione a termine scaduta viene revocata qui, al primo
          // accesso successivo: e' il punto in cui l'utente si ripresenta.
          await applyBanExpiry(user);
          return user;
        }
      }
    } catch (jwtErr) {
      // Token assente, scaduto o non valido: si prosegue come anonimo.
    }
  }

  /**
   * 2. Il secondo percorso di autenticazione — RIMOSSO (S2).
   *
   * Qui c'era un ramo Clerk che, trovando un `userId` senza un account
   * corrispondente, ne CREAVA uno con i crediti di benvenuto:
   *
   *     user = await User.create({ clerkId, ..., credits: welcomeCredits() });
   *
   * Non passava da `/register`, quindi non incontrava né il codice d'invito
   * della beta chiusa, né `registerLimiter`, né la data di nascita. Il
   * middleware si montava se `CLERK_PUBLISHABLE_KEY` iniziava per `pk_test_c`
   * — condizione vera anche con `NODE_ENV=production`, cioè esattamente la
   * configurazione plausibile di una beta. E un'istanza di sviluppo Clerk
   * accetta registrazioni da chiunque: N identità là fuori diventavano N
   * account qui, ognuno con cento crediti a carico della quota Gemini
   * condivisa, che è per progetto e non per utente.
   *
   * Non è stato irrigidito ma eliminato, perché Clerk era già stato
   * abbandonato ovunque: `@clerk/clerk-react` non aveva un solo import nel
   * client, l'informativa privacy dichiara che si usa un JWT proprio, e nessun
   * test copriva questo ramo. Restava solo il pezzo che creava account.
   *
   * Due meccanismi di identità sullo stesso modello `User`, con regole
   * d'ingresso diverse, sono un difetto anche quando entrambi funzionano: la
   * più permessiva è quella che conta, ed è quella che nessuno guarda.
   *
   */

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
    // L'autenticazione facoltativa non deve far fallire la richiesta, ma un
    // guasto qui degrada in silenzio un utente connesso ad anonimo: senza
    // traccia, il sintomo è «ogni tanto mi ritrovo disconnesso» e non c'è nulla
    // da cercare nei log.
    warnFailure(req, error, 'Risoluzione facoltativa dell\'utente non riuscita');
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
    serverFailure(req, res, error, 'Errore durante l\'autenticazione');
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
