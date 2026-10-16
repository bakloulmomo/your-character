const crypto = require('crypto');
const User = require('../models/User');
const { sendMail } = require('./mailService');
const logger = require('./logger');

/**
 * Conferma dell'indirizzo email con un codice a sei cifre.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Sta in un servizio e non nella rotta perche' ha tre chiamanti diversi — la
 * registrazione, il rinvio, e lo script di conferma d'ufficio — e perche' le
 * regole che lo rendono sicuro (impronta invece del codice, tetto ai tentativi,
 * confronto a tempo costante) sono esattamente il genere di cosa che si copia
 * male quando vive dentro un gestore di rotta.
 *
 * LE TRE DECISIONI CHE CONTANO:
 *
 *  · SI CONSERVA L'IMPRONTA, MAI IL CODICE. Stesso trattamento dei token di
 *    recupero password. Chi leggesse il database — un backup finito nel posto
 *    sbagliato, un accesso di sola lettura di troppo — non potrebbe confermare
 *    l'indirizzo di un altro.
 *
 *  · IL TETTO E' PER CODICE, NON PER ACCOUNT. Cinque tentativi, poi quel codice
 *    e' morto e ne serve uno nuovo. Un tetto per account chiuderebbe fuori per
 *    sempre chi sbaglia a digitare tre volte in tre giorni diversi.
 *
 *  · IL CONFRONTO E' A TEMPO COSTANTE. Con sei cifre e un tetto di cinque
 *    tentativi un attacco temporale e' teorico, ma `timingSafeEqual` costa una
 *    riga e non doverci ripensare vale piu' della riga.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
/** Sette giorni per confermare, poi l'indirizzo torna libero. */
const UNVERIFIED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Un rinvio al minuto: piu' spesso non farebbe arrivare la posta prima. */
const RESEND_COOLDOWN_MS = 60 * 1000;

const hashCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');

/**
 * Sei cifre da un generatore crittografico.
 *
 * `randomInt` e non `Math.random()`: quest'ultimo e' prevedibile, e prevedere
 * il codice di conferma di un altro e' esattamente l'attacco.
 */
const generateCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

const equalHash = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

const corpo = (username, code) => [
  `Ciao ${username},`,
  '',
  'il tuo codice di conferma per your-character è:',
  '',
  `    ${code}`,
  '',
  'Vale 15 minuti. Se non hai creato tu questo account, ignora questo messaggio:',
  'senza il codice, l\'account non verrà mai attivato e sparirà da solo entro una settimana.',
  '',
  '— your-character'
].join('\n');

/**
 * Genera un codice, lo salva come impronta e lo invia.
 *
 * @returns {Promise<{sent: boolean, reason?: string}>}
 *          Non solleva: alla registrazione un errore di posta non deve
 *          annullare la creazione dell'account, altrimenti un fornitore di
 *          posta giu' equivale a un sito che non accetta iscrizioni.
 */
async function issueVerificationCode(user, { force = false } = {}) {
  if (user.emailVerifiedAt) return { sent: false, reason: 'gia_verificato' };

  const ora = new Date();

  // Freno al rinvio, valutato sul dato salvato: due schede aperte non devono
  // poter mandare due email.
  if (!force && user.emailVerificationSentAt &&
      ora - new Date(user.emailVerificationSentAt) < RESEND_COOLDOWN_MS) {
    return { sent: false, reason: 'troppo_presto' };
  }

  const code = generateCode();

  await User.updateOne({ _id: user._id }, {
    $set: {
      emailVerificationCodeHash: hashCode(code),
      emailVerificationExpiresAt: new Date(ora.getTime() + CODE_TTL_MS),
      emailVerificationSentAt: ora,
      // Codice nuovo, conto azzerato: il tetto protegge il codice corrente.
      emailVerificationAttempts: 0,
      unverifiedExpiresAt: new Date(ora.getTime() + UNVERIFIED_TTL_MS)
    }
  });

  const esito = await sendMail({
    to: user.email,
    subject: `Il tuo codice: ${code}`,
    text: corpo(user.username, code)
  });

  if (!esito.delivered) {
    // Si registra il DESTINATARIO e il motivo, mai il codice: il corpo
    // dell'email non entra nei log, per la stessa ragione per cui non ci entra
    // il link di recupero password.
    logger.error({ to: user.email, reason: esito.reason }, 'Codice di conferma NON recapitato');
  }

  return { sent: !!esito.delivered, reason: esito.reason };
}

/**
 * Verifica un codice.
 *
 * @returns {Promise<{ok: boolean, reason?: string, attemptsLeft?: number}>}
 *
 * I motivi sono distinti di proposito: «scaduto» e «sbagliato» chiedono due
 * gesti diversi all'utente — chiedere un codice nuovo, o rileggere quello che
 * ha davanti — e confonderli in un unico «non valido» lo lascia a indovinare.
 * Non c'e' rischio di enumerazione: per arrivare qui bisogna gia' essere
 * autenticati come il titolare dell'account.
 */
async function verifyCode(userId, code) {
  const user = await User.findById(userId)
    .select('+emailVerificationCodeHash +emailVerificationExpiresAt +emailVerificationAttempts');

  if (!user) return { ok: false, reason: 'utente_non_trovato' };
  if (user.emailVerifiedAt) return { ok: true, reason: 'gia_verificato' };
  if (!user.emailVerificationCodeHash) return { ok: false, reason: 'nessun_codice' };

  if (!user.emailVerificationExpiresAt || user.emailVerificationExpiresAt < new Date()) {
    return { ok: false, reason: 'scaduto' };
  }

  if ((user.emailVerificationAttempts || 0) >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'troppi_tentativi' };
  }

  if (!equalHash(hashCode(String(code || '').trim()), user.emailVerificationCodeHash)) {
    const dopo = await User.findOneAndUpdate(
      { _id: user._id },
      { $inc: { emailVerificationAttempts: 1 } },
      { new: true, select: '+emailVerificationAttempts' }
    );
    const usati = (dopo && dopo.emailVerificationAttempts) || MAX_ATTEMPTS;
    return { ok: false, reason: 'codice_errato', attemptsLeft: Math.max(0, MAX_ATTEMPTS - usati) };
  }

  await User.updateOne({ _id: user._id }, {
    $set: {
      emailVerifiedAt: new Date(),
      // Il codice consumato sparisce, e con lui la scadenza dell'account: da
      // qui in poi il TTL non guarda piu' questo documento.
      emailVerificationCodeHash: null,
      emailVerificationExpiresAt: null,
      emailVerificationAttempts: 0,
      unverifiedExpiresAt: null
    }
  });

  return { ok: true };
}

module.exports = {
  issueVerificationCode,
  verifyCode,
  generateCode,
  hashCode,
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  UNVERIFIED_TTL_MS,
  RESEND_COOLDOWN_MS
};
