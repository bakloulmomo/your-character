/**
 * Canale di feedback della beta.
 *
 * Durante una beta chiusa la domanda non e' «funziona?» ma «tornerebbero, e
 * pagherebbero?». Nessun log risponde a quella domanda: rispondono le persone,
 * se hanno dove dirlo.
 *
 * Il test piu' importante e' quello sul mailer spento: un canale di feedback
 * che perde i messaggi quando la posta non funziona smette di funzionare
 * proprio quando qualcosa non va.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Character = require('../models/Character');
const Feedback = require('../models/Feedback');

let mongoServer;
let utente;
let token;

const tokenFor = (u) =>
  jwt.sign({ id: u._id, email: u.email, username: u.username, tv: u.tokenVersion || 0 },
    process.env.JWT_SECRET, { expiresIn: '1h' });

const invia = (corpo, t = token) =>
  request(app).post('/api/feedback').set('Authorization', `Bearer ${t}`).send(corpo);

describe('Feedback della beta', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}), Feedback.deleteMany({}),
      Chat.deleteMany({}), Message.deleteMany({}), Character.deleteMany({})
    ]);
    utente = await User.create({
    emailVerifiedAt: new Date(),
      email: 'utente@example.com', username: 'utente', authProvider: 'local',
      birthdate: new Date('1990-01-01'), credits: 42
    });
    token = tokenFor(utente);
  });

  it('un opinione con voto e testo viene salvata', async () => {
    const res = await invia({ type: 'review', rating: 5, message: 'Mi piace molto.' });
    expect(res.status).toBe(201);

    const salvato = await Feedback.findOne({});
    expect(salvato.rating).toBe(5);
    expect(salvato.message).toBe('Mi piace molto.');
    expect(salvato.type).toBe('review');
  });

  it('viene salvata ANCHE senza servizio di posta configurato', async () => {
    // In test RESEND_API_KEY non esiste: l'email non parte. L'opinione deve
    // restare comunque, altrimenti il canale perde messaggi proprio quando
    // l'infrastruttura ha un problema.
    const res = await invia({ type: 'review', rating: 4, message: 'Buono.' });
    expect(res.status).toBe(201);
    expect(await Feedback.countDocuments({})).toBe(1);
    expect((await Feedback.findOne({})).notified).toBe(false);
  });

  it('registra quanti messaggi aveva scritto: un giudizio dopo due non pesa come uno dopo ottanta', async () => {
    const personaggio = await Character.create({
      name: 'Aria', description: 'Una descrizione sufficientemente lunga.',
      personality: 'Una personalita con almeno venti caratteri dentro.',
      avatar: 'https://example.com/a.jpg', createdBy: utente._id,
      isPublic: true, moderationStatus: 'approved', systemPrompt: 'x'
    });
    const chat = await Chat.create({ userId: utente._id, characterId: personaggio._id, title: 'c' });
    await Message.create([
      { chatId: chat._id, role: 'user', content: 'uno' },
      { chatId: chat._id, role: 'assistant', content: 'risposta' },
      { chatId: chat._id, role: 'user', content: 'due' }
    ]);

    await invia({ type: 'review', rating: 5, message: 'Ottimo' });
    expect((await Feedback.findOne({})).messagesSent).toBe(2);
  });

  it('«voglio continuare» non richiede testo: il segnale e il gesto stesso', async () => {
    const res = await invia({ type: 'wants_more' });
    expect(res.status).toBe(201);
    expect((await Feedback.findOne({})).type).toBe('wants_more');
  });

  it('ma un opinione vuota viene rifiutata: non riempie la casella di righe vuote', async () => {
    const res = await invia({ type: 'review', message: '   ' });
    expect(res.status).toBe(400);
    expect(await Feedback.countDocuments({})).toBe(0);
  });

  it('un tipo inventato viene rifiutato', async () => {
    expect((await invia({ type: 'qualsiasi', message: 'x' })).status).toBe(400);
  });

  it('serve essere autenticati', async () => {
    expect((await request(app).post('/api/feedback').send({ type: 'review', rating: 5 })).status).toBe(401);
  });

  describe('lettura, riservata a chi gestisce l app', () => {
    it('un utente normale non vede nemmeno che la rotta esiste', async () => {
      expect((await request(app).get('/api/feedback').set('Authorization', `Bearer ${token}`)).status).toBe(404);
    });

    it('un amministratore vede i feedback e il riepilogo che conta', async () => {
      await invia({ type: 'review', rating: 5, message: 'Bello' });
      await invia({ type: 'review', rating: 3, message: 'Cosi cosi' });
      await invia({ type: 'wants_more' });

      const admin = await User.create({
    emailVerifiedAt: new Date(),
        email: 'admin@example.com', username: 'admin', authProvider: 'local', role: 'admin'
      });
      const res = await request(app).get('/api/feedback')
        .set('Authorization', `Bearer ${tokenFor(admin)}`);

      expect(res.status).toBe(200);
      expect(res.body.feedback).toHaveLength(3);
      expect(res.body.riepilogo.totale).toBe(3);
      // Il numero che conta di piu' durante la beta.
      expect(res.body.riepilogo.voglionoContinuare).toBe(1);
      expect(res.body.riepilogo.votoMedio).toBe(4);
    });
  });
});
