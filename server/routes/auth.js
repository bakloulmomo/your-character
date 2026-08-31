const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const User = require('../models/User');
const { sendMail } = require('../services/mailService');
const { requireAuth, attachUser } = require('../middleware/auth');
const { jwtSecret, isProduction, adminEmails, welcomeCredits, betaInviteCode, features } = require('../config/env');
const { serverFailure, warnFailure } = require('../services/failure');

const getJwtSecret = () => jwtSecret();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Limiti di frequenza su accesso e registrazione.
 *
 * I valori sono configurabili (FASE E): restano quelli di prima come default,
 * ma un ambiente diverso deve poterli cambiare senza toccare il codice. Serviva
 * ai test end-to-end, che registrano un account per esecuzione dallo stesso
 * indirizzo e dopo cinque esecuzioni venivano fermati dal limite — abbassare la
 * protezione nel prodotto per far passare i test sarebbe stato il rimedio
 * sbagliato; renderla configurabile è ciò che serviva comunque.
 */
const positiveInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const loginLimiter = rateLimit({
  windowMs: positiveInt(process.env.LOGIN_RATE_WINDOW_MS, 15 * 60 * 1000),
  max: positiveInt(process.env.LOGIN_RATE_MAX, 5),
  message: { error: 'Troppi tentativi di accesso. Riprova tra 15 minuti.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => process.env.NODE_ENV === 'test'
});

const registerLimiter = rateLimit({
  windowMs: positiveInt(process.env.REGISTER_RATE_WINDOW_MS, 60 * 60 * 1000),
  max: positiveInt(process.env.REGISTER_RATE_MAX, 5),
  message: { error: 'Troppe registrazioni effettuate da questo IP. Riprova più tardi.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test'
});


// Zod Input Validation Schemas
// Computes full years between a birthdate and now (UTC).
const ageFrom = (dateStr) => {
  const d = new Date(dateStr);
  const n = new Date();
  let age = n.getUTCFullYear() - d.getUTCFullYear();
  const m = n.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && n.getUTCDate() < d.getUTCDate())) age--;
  return age;
};

const registerSchema = z.object({
  email: z.string().email('Indirizzo email non valido').trim().toLowerCase(),
  username: z.string()
    .min(3, 'Lo username deve contenere almeno 3 caratteri')
    .max(30, 'Lo username può contenere al massimo 30 caratteri')
    .regex(/^[a-zA-Z0-9_]+$/, 'Lo username può contenere solo lettere, numeri e underscore'),
  password: z.string()
    .min(8, 'La password deve contenere almeno 8 caratteri')
    .regex(/[A-Z]/, 'La password deve contenere almeno una lettera maiuscola')
    .regex(/[0-9]/, 'La password deve contenere almeno un numero'),
  // Age verification is mandatory (18+ policy). Reject invalid or under-age dates.
  birthdate: z.string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'Data di nascita non valida')
    .refine((s) => ageFrom(s) >= 18 && ageFrom(s) < 120, 'Devi avere almeno 18 anni per registrarti')
});

/**
 * Codice d'invito della beta chiusa.
 *
 * Facoltativo nello schema perche' la verifica dipende dalla configurazione:
 * se `BETA_INVITE_CODE` non e' impostato la registrazione resta aperta, e
 * imporre un campo che nessuno controlla sarebbe solo un ostacolo inutile.
 */
const inviteMatches = (provided) => {
  const expected = betaInviteCode();
  if (!expected) return true;
  return String(provided || '').trim().toLowerCase() === expected.toLowerCase();
};

const loginSchema = z.object({
  email: z.string().email('Indirizzo email non valido').trim().toLowerCase(),
  password: z.string().min(1, 'La password è richiesta')
});

// Helper to generate JWT Token
const generateToken = (user) => {
  return jwt.sign(
    // `tv` è la versione della sessione: il logout la incrementa sull'account
    // e da quel momento questo token non viene più accettato.
    { id: user._id, email: user.email, username: user.username, tv: user.tokenVersion || 0 },
    getJwtSecret(),
    { expiresIn: JWT_EXPIRES_IN }
  );
};

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProduction(),
  sameSite: 'lax'
};


// Helper to sanitize User response object
const formatUserResponse = (user) => ({
  id: user._id,
  email: user.email,
  username: user.username,
  avatar: user.avatar,
  birthdate: user.birthdate,
  credits: user.credits,
  subscription: user.subscription,
  subscriptionExpiresAt: user.subscriptionExpiresAt,
  dailyMessageCount: user.dailyMessageCount,
  dailyImageCount: user.dailyImageCount,
  authProvider: user.authProvider,
  // Il client ne ha bisogno per mostrare l'accesso alla coda di revisione, il
  // pannello dei contenuti per adulti e lo stato del consenso ai cookie.
  role: user.role || 'user',
  isAdult: typeof user.isAdult === 'function' ? user.isAdult() : false,
  nsfwEnabled: user.nsfwEnabled === true,
  cookieConsent: user.cookieConsent || null,
  billingCountry: user.billingCountry || null,
  createdAt: user.createdAt
});

/**
 * Innesco del primo moderatore (FASE D — S2-13).
 *
 * Il ruolo si assegna normalmente con `scripts/grantRole.js`, ma su un'istanza
 * appena creata nessuno può ancora eseguirlo su un account che non esiste:
 * `ADMIN_EMAILS` risolve la partenza a freddo. Viene applicato all'accesso, non
 * letto a ogni richiesta, così il ruolo resta scritto sull'account e revocarlo
 * dalla variabile non ne cancella la traccia.
 */
async function applyAdminBootstrap(user) {
  const admins = adminEmails();
  if (admins.length === 0) return user;
  if (!admins.includes((user.email || '').toLowerCase())) return user;
  if (user.role === 'admin') return user;

  user.role = 'admin';
  await user.save();
  return user;
}

// POST /api/auth/register - Register new local user account
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map(e => e.message).join('. ');
      return res.status(400).json({ error: errorMsg });
    }

    const { email, username, password, birthdate } = parseResult.data;

    // Beta chiusa: senza un invito valido non si entra. Il controllo sta prima
    // di ogni scrittura, cosi' un tentativo respinto non lascia nulla dietro.
    if (!inviteMatches(req.body.inviteCode)) {
      return res.status(403).json({
        error: 'Questo codice d\'invito non e\' valido. La beta e\' su invito: se ne hai ricevuto uno, controlla di averlo copiato per intero.',
        requiresInvite: true
      });
    }

    // Controllo preventivo: dà un messaggio preciso nel caso normale.
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ error: 'Indirizzo email già registrato' });
    }

    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(400).json({ error: 'Username già in uso' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const parsedBirthdate = birthdate ? new Date(birthdate) : null;

    // La vera garanzia di unicità sono gli indici del database: il controllo
    // qui sopra e la creazione non sono atomici, quindi due registrazioni
    // simultanee lo superavano entrambe e la seconda esplodeva in un 500.
    // L'errore di chiave duplicata viene tradotto nel messaggio corretto.
    let newUser;
    try {
      newUser = await User.create({
        email,
        username,
        passwordHash,
        birthdate: parsedBirthdate,
        authProvider: 'local',
        // In beta gratuita i pagamenti sono spenti: dieci crediti sarebbero
        // dieci messaggi e nessun modo di proseguire (vedi welcomeCredits).
        credits: welcomeCredits(),
        subscription: 'free',
        lastLoginAt: new Date()
      });
    } catch (createErr) {
      if (createErr && createErr.code === 11000) {
        const duplicatedField = Object.keys(createErr.keyPattern || {})[0];
        return res.status(400).json({
          error: duplicatedField === 'username'
            ? 'Username già in uso'
            : 'Indirizzo email già registrato'
        });
      }
      throw createErr;
    }


    await applyAdminBootstrap(newUser);

    const token = generateToken(newUser);

    // Set secure HttpOnly Cookie
    res.cookie('yc_token', token, { ...SESSION_COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 * 1000 });

    res.status(201).json({
      message: 'Registrazione completata con successo',
      token,
      user: formatUserResponse(newUser)
    });
  } catch (error) {
    serverFailure(req, res, error, 'Errore durante la registrazione');
  }
});

// POST /api/auth/login - Authenticate local user with brute-force rate limit & timing protection
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Credenziali non valide' });
    }

    const { email, password } = parseResult.data;

    // Fetch user including hidden passwordHash
    const user = await User.findOne({ email }).select('+passwordHash');

    // Protect against account enumeration / timing attacks
    if (!user || !user.passwordHash) {
      // Simulate bcrypt comparison delay to avoid timing side-channels
      await bcrypt.compare(password, '$2a$12$eImiTXuWVxfM37uY4JANjO5xT2y5nZkO5fJ2l1gJ0V/7dK2y5nZkO');
      return res.status(401).json({ error: 'Credenziali non valide' });
    }

    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Credenziali non valide' });
    }

    if (user.isBanned) {
      return res.status(403).json({
        error: 'Account sospeso',
        reason: user.banReason || 'Violazione dei termini di servizio'
      });
    }

    // Update last login timestamp
    user.lastLoginAt = new Date();
    await user.save();
    await applyAdminBootstrap(user);

    const token = generateToken(user);

    res.cookie('yc_token', token, { ...SESSION_COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 * 1000 });

    res.json({
      message: 'Accesso effettuato con successo',
      token,
      user: formatUserResponse(user)
    });
  } catch (error) {
    serverFailure(req, res, error, 'Errore durante l\'accesso');
  }
});

// POST /api/auth/logout - Chiude la sessione e REVOCA i token già emessi.
// Cancellare il cookie non basta: il JWT resterebbe valido fino alla scadenza
// e continuerebbe a funzionare da qualsiasi altro client.
router.post('/logout', attachUser, async (req, res) => {
  try {
    if (req.user) {
      await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
    }
  } catch (error) {
    // La disconnessione prosegue comunque: il cookie viene cancellato. Ma la
    // revoca mancata significa che i token già emessi restano validi fino alla
    // scadenza, ed è esattamente il genere di cosa che deve lasciare traccia.
    warnFailure(req, error, 'Revoca dei token non riuscita durante la disconnessione');
  }

  res.clearCookie('yc_token', SESSION_COOKIE_OPTIONS);
  res.json({ success: true, message: 'Disconnessione effettuata con successo' });
});

const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Troppe richieste di recupero. Riprova più tardi.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' && process.env.FORCE_RATE_LIMIT !== '1'
});

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// POST /api/auth/forgot-password - Avvia il recupero della password.
//
// Chi dimenticava la password restava escluso per sempre: non esisteva alcun
// modo di rientrare (S2-10).
router.post('/forgot-password', resetLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Indirizzo email richiesto' });

    const user = await User.findOne({ email, authProvider: 'local' });

    // La risposta è identica che l'account esista o no: rivelarlo permetterebbe
    // di scoprire quali indirizzi sono registrati.
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      user.passwordResetTokenHash = hashToken(token);
      user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await user.save();

      const base = process.env.FRONTEND_URL || 'http://localhost:5173';
      await sendMail({
        to: email,
        subject: 'Reimposta la tua password — your-character',
        text: `Apri questo link per scegliere una nuova password (scade fra un'ora):\n\n${base}/reset-password?token=${token}\n\nSe non hai richiesto tu il recupero, ignora questo messaggio.`
      });
    }

    res.json({ success: true });
  } catch (error) {
    serverFailure(req, res, error, 'Impossibile avviare il recupero');
  }
});

// POST /api/auth/reset-password - Completa il recupero con il token ricevuto.
router.post('/reset-password', resetLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Token mancante' });
    }

    const passwordCheck = z.string()
      .min(8, 'La password deve contenere almeno 8 caratteri')
      .regex(/[A-Z]/, 'La password deve contenere almeno una lettera maiuscola')
      .regex(/[0-9]/, 'La password deve contenere almeno un numero')
      .safeParse(password);

    if (!passwordCheck.success) {
      return res.status(400).json({ error: passwordCheck.error.errors[0].message });
    }

    const user = await User.findOne({
      passwordResetTokenHash: hashToken(token),
      passwordResetExpiresAt: { $gt: new Date() }
    }).select('+passwordResetTokenHash +passwordResetExpiresAt');

    if (!user) {
      return res.status(400).json({ error: 'Link non valido o scaduto' });
    }

    user.passwordHash = await bcrypt.hash(passwordCheck.data, 12);
    user.passwordResetTokenHash = null;
    user.passwordResetExpiresAt = null;
    // Cambiare password chiude tutte le sessioni aperte: se qualcun altro era
    // entrato, da questo momento non lo è più.
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    res.json({ success: true, message: 'Password aggiornata. Ora puoi accedere.' });
  } catch (error) {
    serverFailure(req, res, error, 'Impossibile reimpostare la password');
  }
});

// GET /api/auth/me - Retrieve currently authenticated user profile
router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: formatUserResponse(req.user)
  });
});

module.exports = router;
