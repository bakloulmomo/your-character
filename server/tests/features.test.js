/**
 * Interruttori di funzionalità — beta chiusa e gratuita.
 *
 * Il prodotto parte senza pagamenti, senza abbonamenti e senza generazione di
 * immagini. Questi test verificano la cosa che conta: che le rotte siano
 * davvero chiuse sul SERVER. Nascondere un pulsante non spegne una funzione —
 * chi vuole aggirarla non passa dall'interfaccia.
 *
 * Verificano anche il verso opposto: che riaccendere l'interruttore riapra la
 * funzione. Un interruttore che spegne e non riaccende non è un interruttore,
 * è codice morto travestito.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Character = require('../models/Character');

let mongoServer;
let utente;
let token;
let chat;

const FLAGS = ['FEATURE_PAYMENTS', 'FEATURE_SUBSCRIPTIONS', 'FEATURE_IMAGE_GENERATION', 'BETA_INVITE_CODE', 'WELCOME_CREDITS'];
const originali = {};

const tokenFor = (user) =>
  jwt.sign({ id: user._id, email: user.email, username: user.username, tv: user.tokenVersion || 0 },
    process.env.JWT_SECRET, { expiresIn: '1h' });

const auth = (r) => r.set('Authorization', `Bearer ${token}`);

describe('Interruttori di funzionalità', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    FLAGS.forEach((k) => { originali[k] = process.env[k]; });
  }, 30000);

  afterAll(async () => {
    FLAGS.forEach((k) => {
      if (originali[k] === undefined) delete process.env[k];
      else process.env[k] = originali[k];
    });
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  beforeEach(async () => {
    FLAGS.forEach((k) => delete process.env[k]);
    await Promise.all([User.deleteMany({}), Chat.deleteMany({}), Character.deleteMany({})]);

    utente = await User.create({
      email: 'beta@example.com', username: 'beta', authProvider: 'local',
      birthdate: new Date('1990-01-01'), credits: 500
    });
    token = tokenFor(utente);

    const personaggio = await Character.create({
      name: 'Aria', description: 'Una descrizione sufficientemente lunga.',
      personality: 'Una personalità con almeno venti caratteri dentro.',
      avatar: 'https://example.com/a.jpg', createdBy: utente._id,
      isPublic: true, moderationStatus: 'approved', systemPrompt: 'x'
    });
    chat = await Chat.create({ userId: utente._id, characterId: personaggio._id, title: 'c' });
  });

  describe('per difetto tutto è spento — una variabile dimenticata non accende nulla', () => {
    it('features() riporta i tre interruttori a false', () => {
      const { features } = require('../config/env');
      expect(features()).toEqual({ payments: false, subscriptions: false, imageGeneration: false });
    });

    it('GET /api/config lo dichiara al client', async () => {
      const res = await request(app).get('/api/config');
      expect(res.status).toBe(200);
      expect(res.body.features).toEqual({ payments: false, subscriptions: false, imageGeneration: false });
      expect(res.body.inviteRequired).toBe(false);
    });

    it('GET /api/config non rivela il codice d\'invito, solo che serve', async () => {
      process.env.BETA_INVITE_CODE = 'PAROLA-SEGRETA';
      const res = await request(app).get('/api/config');
      expect(res.body.inviteRequired).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('PAROLA-SEGRETA');
    });
  });

  describe('immagini spente', () => {
    it('POST /api/images/generate risponde 404, non 403', async () => {
      const res = await auth(request(app).post('/api/images/generate'))
        .send({ chatId: chat._id.toString(), prompt: 'un gatto su un tetto' });
      expect(res.status).toBe(404);
      expect(res.body.disabled).toBe(true);
    });

    it('e non addebita nulla', async () => {
      await auth(request(app).post('/api/images/generate'))
        .send({ chatId: chat._id.toString(), prompt: 'un gatto su un tetto' });
      const dopo = await User.findById(utente._id);
      expect(dopo.credits).toBe(500);
    });

    it('ma riaccendendo l\'interruttore la rotta torna disponibile', async () => {
      process.env.FEATURE_IMAGE_GENERATION = 'true';
      const res = await auth(request(app).post('/api/images/generate'))
        .send({ chatId: chat._id.toString(), prompt: 'un gatto su un tetto' });
      expect(res.status).not.toBe(404);
    });
  });

  describe('pagamenti spenti', () => {
    const chiuse = [
      ['get', '/api/payments/packages'],
      ['post', '/api/payments/checkout'],
      ['post', '/api/payments/confirm'],
      ['get', '/api/payments/vat-preview?packageId=starter']
    ];

    it.each(chiuse)('%s %s risponde 404', async (metodo, url) => {
      const res = await auth(request(app)[metodo](url)).send({});
      expect(res.status).toBe(404);
    });

    it('ma lo storico dei propri pagamenti resta accessibile: sono dati dell\'utente', async () => {
      const res = await auth(request(app).get('/api/payments/transactions'));
      expect(res.status).toBe(200);
    });

    it('e il webhook resta raggiungibile, perché Stripe può ritentare eventi già emessi', async () => {
      const res = await request(app).post('/api/payments/webhook').send({});
      // 400 (firma mancante), non 404: la rotta esiste e rifiuta per il motivo giusto.
      expect(res.status).toBe(400);
    });
  });

  describe('abbonamenti spenti', () => {
    it('POST /api/payments/subscribe risponde 404', async () => {
      const res = await auth(request(app).post('/api/payments/subscribe')).send({ plan: 'monthly' });
      expect(res.status).toBe(404);
    });

    it('restano spenti anche se i pagamenti vengono accesi: sono due decisioni distinte', async () => {
      process.env.FEATURE_PAYMENTS = 'true';
      const res = await auth(request(app).post('/api/payments/subscribe')).send({ plan: 'monthly' });
      expect(res.status).toBe(404);
    });
  });

  describe('crediti di benvenuto', () => {
    it('senza pagamenti sono 100: dieci non basterebbero per una conversazione', () => {
      const { welcomeCredits } = require('../config/env');
      expect(welcomeCredits()).toBe(100);
    });

    it('con i pagamenti accesi tornano a 10, perché da lì si compra', () => {
      process.env.FEATURE_PAYMENTS = 'true';
      const { welcomeCredits } = require('../config/env');
      expect(welcomeCredits()).toBe(10);
    });

    it('e un nuovo iscritto li riceve davvero', async () => {
      process.env.WELCOME_CREDITS = '250';
      const res = await request(app).post('/api/auth/register').send({
        email: 'nuovo@example.com', username: 'nuovo',
        password: 'PasswordSicura1', birthdate: '1990-05-12'
      });
      expect(res.status).toBe(201);
      expect(res.body.user.credits).toBe(250);
    });
  });

  describe('beta su invito', () => {
    const nuovoUtente = {
      email: 'invitato@example.com', username: 'invitato',
      password: 'PasswordSicura1', birthdate: '1990-05-12'
    };

    it('senza codice configurato la registrazione resta aperta', async () => {
      const res = await request(app).post('/api/auth/register').send(nuovoUtente);
      expect(res.status).toBe(201);
    });

    it('con il codice configurato, senza invito si viene respinti', async () => {
      process.env.BETA_INVITE_CODE = 'AMICI-2026';
      const res = await request(app).post('/api/auth/register').send(nuovoUtente);
      expect(res.status).toBe(403);
      expect(res.body.requiresInvite).toBe(true);
    });

    it('e nessun account viene creato da un tentativo respinto', async () => {
      process.env.BETA_INVITE_CODE = 'AMICI-2026';
      await request(app).post('/api/auth/register').send(nuovoUtente);
      expect(await User.findOne({ email: nuovoUtente.email })).toBeNull();
    });

    it('con il codice giusto si entra, ignorando maiuscole e spazi', async () => {
      process.env.BETA_INVITE_CODE = 'AMICI-2026';
      const res = await request(app).post('/api/auth/register')
        .send({ ...nuovoUtente, inviteCode: '  amici-2026 ' });
      expect(res.status).toBe(201);
    });
  });
});
