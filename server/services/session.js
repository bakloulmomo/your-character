const jwt = require('jsonwebtoken');
const { jwtSecret, isProduction } = require('../config/env');

/**
 * La sessione: durata, firma, cookie, rinnovo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Sta in un servizio perche' ha DUE proprietari naturali che non possono
 * importarsi a vicenda: `routes/auth.js` emette il token, `middleware/auth.js`
 * lo verifica. Finche' la durata e le opzioni del cookie vivevano nelle rotte,
 * il middleware non poteva rinnovare nulla senza una dipendenza circolare — ed
 * e' esattamente il motivo per cui la rotazione non esisteva.
 *
 * PERCHE' DUE GIORNI E NON SETTE. Un token rubato vale finche' non scade. Sette
 * giorni fissi, senza rotazione, sono una settimana di accesso per chi lo
 * intercetta — e sette non era un numero misurato, era il default che si scrive
 * senza pensarci.
 *
 * PERCHE' NON QUATTRO ORE. Perche' scadere addosso a chi sta usando il prodotto
 * e' un danno certo in cambio di un guadagno marginale. Il rinnovo silenzioso
 * risolve la tensione: chi torna entro due giorni non si accorge di nulla e
 * ogni visita sposta in avanti la scadenza; chi ha smesso di usarlo esce da
 * solo, e con lui esce chiunque gli avesse sottratto il token.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SESSION_TTL = process.env.JWT_EXPIRES_IN || '2d';
const SESSION_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Sotto le dodici ore residue la sessione si rinnova da sola.
 *
 * Non a ogni richiesta: rifirmare e riscrivere il cookie su ognuna
 * significherebbe un `Set-Cookie` su ogni risposta, comprese quelle in
 * streaming, per un guadagno nullo. La soglia fa si' che il rinnovo avvenga
 * al massimo una volta ogni dodici ore per sessione attiva.
 */
const SESSION_RENEW_BELOW_MS = 12 * 60 * 60 * 1000;

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProduction(),
  sameSite: 'lax'
};

const COOKIE_NAME = 'yc_token';

/**
 * Firma un token per questo utente.
 *
 * `tv` e' la versione della sessione: logout, cambio password e sospensione la
 * incrementano sull'account, e da quel momento i token gia' emessi non valgono
 * piu' nulla. E' cio' che rende una revoca davvero immediata invece di
 * doverla aspettare fino alla scadenza.
 */
function signSession(user) {
  return jwt.sign(
    { id: user._id, email: user.email, username: user.username, tv: user.tokenVersion || 0 },
    jwtSecret(),
    { expiresIn: SESSION_TTL }
  );
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_MAX_AGE_MS });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, SESSION_COOKIE_OPTIONS);
}

/**
 * Rinnova la sessione se sta per scadere.
 *
 * @param {object} res       Risposta Express.
 * @param {object} user      Utente risolto.
 * @param {object} decoded   Contenuto del token verificato (serve `exp`).
 * @returns {boolean}        Se ha rinnovato.
 *
 * NON solleva mai e non blocca la richiesta: un rinnovo mancato costa
 * all'utente una nuova autenticazione fra qualche ora, un'eccezione qui gli
 * costerebbe la richiesta che stava facendo.
 *
 * Il cookie viene riscritto solo se le intestazioni non sono ancora partite:
 * su una risposta in streaming (SSE) sono gia' state inviate, e `res.cookie`
 * solleverebbe.
 */
function renewIfStale(res, user, decoded) {
  try {
    if (!res || res.headersSent || !decoded || !decoded.exp) return false;

    const residuo = decoded.exp * 1000 - Date.now();
    if (residuo > SESSION_RENEW_BELOW_MS) return false;

    setSessionCookie(res, signSession(user));
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  signSession,
  setSessionCookie,
  clearSessionCookie,
  renewIfStale,
  SESSION_TTL,
  SESSION_MAX_AGE_MS,
  SESSION_RENEW_BELOW_MS,
  SESSION_COOKIE_OPTIONS,
  COOKIE_NAME
};
