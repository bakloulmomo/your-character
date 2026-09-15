/**
 * Protezione della quota gratuita condivisa.
 *
 * Il piano gratuito di Gemini concede un numero fisso di richieste al giorno
 * per l'intero progetto, non per utente. Senza un tetto individuale, una sola
 * persona presa dalla conversazione lo esaurirebbe per tutti entro mezzogiorno.
 *
 * Questi test verificano le due meta' della protezione: che il tetto funzioni,
 * e che l'utente capisca cosa gli e' successo — «crediti finiti» e «torna
 * domani» richiedono azioni diverse, e un messaggio unico le confonderebbe.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Character = require('../models/Character');
const { reserveAllowance } = require('../models/User');
const { isQuotaError, QuotaExceededError } = require('../services/geminiService');

let mongoServer;
let utente;
let token;
let chat;

const tokenFor = (u) =>
  jwt.sign({ id: u._id, email: u.email, username: u.username, tv: u.tokenVersion || 0 },
    process.env.JWT_SECRET, { expiresIn: '1h' });

const invia = (testo) =>
  request(app).post('/api/messages')
    .set('Authorization', `Bearer ${token}`)
    .send({ chatId: chat._id.toString(), content: testo });

describe('Tetto giornaliero della beta', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    delete process.env.BETA_DAILY_MESSAGE_CAP;
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  beforeEach(async () => {
    delete process.env.BETA_DAILY_MESSAGE_CAP;
    await Promise.all([User.deleteMany({}), Chat.deleteMany({}), Character.deleteMany({})]);

    utente = await User.create({
    emailVerifiedAt: new Date(),
      email: 'beta@example.com', username: 'beta', authProvider: 'local',
      birthdate: new Date('1990-01-01'), credits: 100
    });
    token = tokenFor(utente);

    const personaggio = await Character.create({
      name: 'Aria', description: 'Una descrizione sufficientemente lunga.',
      personality: 'Una personalita con almeno venti caratteri dentro.',
      avatar: 'https://example.com/a.jpg', createdBy: utente._id,
      isPublic: true, moderationStatus: 'approved', systemPrompt: 'x'
    });
    chat = await Chat.create({ userId: utente._id, characterId: personaggio._id, title: 'c' });
  });

  it('senza tetto configurato i crediti restano l unico limite', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await invia(`messaggio ${i}`)).status).toBe(200);
    }
    expect((await User.findById(utente._id)).credits).toBe(97);
  });

  it('col tetto attivo, superarlo viene rifiutato con 429 e non con 402', async () => {
    process.env.BETA_DAILY_MESSAGE_CAP = '2';

    expect((await invia('uno')).status).toBe(200);
    expect((await invia('due')).status).toBe(200);

    const terzo = await invia('tre');
    expect(terzo.status).toBe(429);
    expect(terzo.body.reason).toBe('daily_cap');
    expect(terzo.body.cap).toBe(2);
  });

  it('e il messaggio spiega che i crediti NON sono stati toccati', async () => {
    process.env.BETA_DAILY_MESSAGE_CAP = '1';
    await invia('uno');
    const bloccato = await invia('due');

    expect(bloccato.body.error).toMatch(/crediti restano/i);
    // Due messaggi tentati, uno solo addebitato.
    expect((await User.findById(utente._id)).credits).toBe(99);
  });

  it('chi ha finito i crediti riceve 402, non il messaggio del tetto', async () => {
    process.env.BETA_DAILY_MESSAGE_CAP = '50';
    await User.findByIdAndUpdate(utente._id, { credits: 0 });

    const res = await invia('ciao');
    expect(res.status).toBe(402);
    expect(res.body.reason).toBe('no_credits');
  });

  it('il tetto e applicato atomicamente: richieste simultanee non lo superano', async () => {
    process.env.BETA_DAILY_MESSAGE_CAP = '3';

    const esiti = await Promise.all(
      Array.from({ length: 8 }, () => reserveAllowance(utente._id, 'free', 'message'))
    );
    const riuscite = esiti.filter((r) => r && !r.blockedBy);
    expect(riuscite).toHaveLength(3);

    const dopo = await User.findById(utente._id);
    expect(dopo.dailyMessageCount).toBe(3);
    expect(dopo.credits).toBe(97);
  });

  it('il rimborso restituisce sia il credito sia il conteggio giornaliero', async () => {
    process.env.BETA_DAILY_MESSAGE_CAP = '5';
    const riserva = await reserveAllowance(utente._id, 'free', 'message');
    await riserva.refund();

    const dopo = await User.findById(utente._id);
    expect(dopo.credits).toBe(100);
    expect(dopo.dailyMessageCount).toBe(0);
  });
});

describe('Quota giornaliera di Gemini esaurita', () => {
  it('un 429 dell API viene riconosciuto in tutte le sue forme', () => {
    expect(isQuotaError({ status: 429 })).toBe(true);
    expect(isQuotaError(new Error('Resource has been exhausted (e.g. check quota).'))).toBe(true);
    expect(isQuotaError(new Error('[429] Too Many Requests'))).toBe(true);
    expect(isQuotaError({ response: { status: 429 } })).toBe(true);
    expect(isQuotaError(new Error('connessione rifiutata'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });

  it('produce un errore riconoscibile, distinto da un guasto generico', () => {
    const err = new QuotaExceededError();
    expect(err.quotaExceeded).toBe(true);
    expect(err.safetyBlocked).toBeUndefined();
  });
});
