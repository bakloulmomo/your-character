const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { jwtSecret, isTest, welcomeCredits } = require('../config/env');
const { applyBanExpiry } = require('../utils/time');
const { renewIfStale } = require('../services/session');
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
const resolveUser = async (req, res) => {
  // 1. JWT nativo (header o cookie)
  const token = extractToken(req);
  if (token) {
    try {
      /**
       * L'algoritmo si dichiara, non si deduce dal token.
       *
       * Senza `algorithms`, `jwt.verify` accetta qualunque algoritmo dichiarato
       * NELL'INTESTAZIONE DEL TOKEN — cioe' da chi il token lo ha scritto. E'
       * la premessa di un'intera famiglia di attacchi di confusione
       * dell'algoritmo. Con HS256 e un segreto solo il rischio pratico oggi e'
       * nullo, ma dipende da una proprieta' della libreria e non da una nostra
       * scelta: il giorno in cui si passasse a una chiave asimmetrica, la
       * differenza sarebbe fra «firmato da noi» e «firmato da chiunque».
       */
      const decoded = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] });
      if (decoded && decoded.id) {
        const user = await User.findById(decoded.id);
        // La versione nel token deve corrispondere a quella dell'account:
        // dopo un logout il vecchio token non vale più nulla.
        if (user && (decoded.tv || 0) === (user.tokenVersion || 0)) {
          // Una sospensione a termine scaduta viene revocata qui, al primo
          // accesso successivo: e' il punto in cui l'utente si ripresenta.
          await applyBanExpiry(user);
          /**
           * Rinnovo silenzioso della sessione.
           *
           * Sta QUI e non in una rotta perche' e' l'unico punto attraversato da
           * ogni richiesta autenticata: rinnovare solo in `/auth/me`
           * significherebbe rinnovare solo a chi ricarica la pagina, e chi
           * tiene la scheda aperta per due giorni verrebbe disconnesso proprio
           * mentre sta usando il prodotto.
           *
           * Non fallisce e non blocca: se il rinnovo non riesce, l'utente
           * dovra' riautenticarsi fra qualche ora — che e' un fastidio, non un
           * errore da propagare alla richiesta in corso.
           */
          renewIfStale(res, user, decoded);
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
          credits: welcomeCredits(),
          /**
           * Con l'indirizzo gia' confermato: questo varco esiste per impersonare
           * un utente ORDINARIO in un test, e un utente ordinario ha l'email
           * confermata. Lasciarlo non verificato farebbe rispondere 403 a
           * `requireVerifiedEmail` prima di ogni controllo di proprieta', e i
           * test che verificano «l'estraneo riceve 404» misurerebbero il
           * cancello sbagliato invece dell'autorizzazione che volevano provare.
           *
           * Chi deve provare il cancello crea l'utente esplicitamente, come fa
           * `emailVerification.test.js`.
           */
          emailVerifiedAt: new Date()
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
    const user = await resolveUser(req, res);
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
    const dbUser = await resolveUser(req, res);

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
