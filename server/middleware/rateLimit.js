const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { isTest } = require('../config/env');

/**
 * Limitatori di frequenza per gli endpoint costosi.
 *
 * Prima esistevano solo su login e registrazione: messaggi e immagini — le due
 * chiamate che costano denaro a ogni invocazione — erano completamente libere
 * (misurato: 30 chiamate simultanee al modello, 0 rifiutate).
 *
 * La chiave è l'utente autenticato quando c'è, altrimenti l'IP: limitare per
 * solo IP punirebbe intere reti condivise e sarebbe aggirabile cambiando IP.
 */
// `ipKeyGenerator` normalizza gli indirizzi IPv6 alla loro subnet: senza di
// esso un utente IPv6 aggirerebbe il limite semplicemente cambiando indirizzo
// all'interno del proprio blocco.
const keyByUser = (req) => (req.user ? `u:${req.user._id}` : `ip:${ipKeyGenerator(req.ip)}`);

// In test i limitatori sono spenti, tranne quando un test li accende
// esplicitamente per verificarli.
const skipInTests = () => isTest() && process.env.FORCE_RATE_LIMIT !== '1';

const build = ({ windowMs, max, message }) =>
  rateLimit({
    windowMs,
    max,
    keyGenerator: keyByUser,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipInTests
  });

// I messaggi sono frequenti per natura: il limite serve a fermare gli script,
// non le conversazioni umane.
const messageLimiter = build({
  windowMs: 60 * 1000,
  max: 20,
  message: 'Stai inviando messaggi troppo rapidamente. Attendi qualche istante.'
});

// Le immagini costano molto di più per chiamata.
const imageLimiter = build({
  windowMs: 60 * 1000,
  max: 5,
  message: 'Hai richiesto troppe immagini in poco tempo. Attendi un minuto.'
});

const createCharacterLimiter = build({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Hai creato troppi personaggi in un ora. Riprova più tardi.'
});

const reportLimiter = build({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Hai inviato troppe segnalazioni. Riprova più tardi.'
});

const checkoutLimiter = build({
  windowMs: 60 * 60 * 1000,
  max: 15,
  message: 'Troppi tentativi di pagamento. Riprova fra un ora.'
});

// L'export GDPR è un dump completo dei dati: pesante da produrre e da servire.
const exportLimiter = build({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: 'Puoi esportare i tuoi dati al massimo 3 volte all ora.'
});

module.exports = {
  messageLimiter,
  imageLimiter,
  createCharacterLimiter,
  reportLimiter,
  checkoutLimiter,
  exportLimiter
};
