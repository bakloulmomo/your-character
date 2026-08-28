/**
 * FASE A — Test di sicurezza economica (regressione permanente).
 *
 * Codifica i difetti S0-1, S0-2, S0-3, S0-4 e S0-9 del piano QA:
 * in produzione non deve esistere alcun percorso che accrediti crediti o attivi
 * un abbonamento senza pagamento, la firma del webhook è sempre obbligatoria e
 * una risposta simulata non può essere fatturata.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const stripeLib = require('stripe');
const app = require('../server');
const User = require('../models/User');
const Character = require('../models/Character');
const Chat = require('../models/Chat');
const Transaction = require('../models/Transaction');
const { assertProductionEnv } = require('../config/env');

let mongoServer;
let user;
let token;

const ENV_KEYS = ['NODE_ENV', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'GEMINI_API_KEY', 'JWT_SECRET', 'MONGODB_URI', 'FRONTEND_URL', 'STABILITY_API_KEY',
  // Con i pagamenti accesi la configurazione di produzione include anche
  // l'intestazione fiscale: senza, le ricevute non sarebbero emettibili.
  'SELLER_NAME', 'SELLER_VAT_NUMBER', 'SELLER_ADDRESS', 'FEATURE_PAYMENTS', 'FEATURE_SUBSCRIPTIONS'];
let savedEnv;

const tokenFor = (u, secret = process.env.JWT_SECRET) =>
  jwt.sign({ id: u._id, email: u.email, username: u.username, tv: u.tokenVersion || 0 }, secret, { expiresIn: '1h' });

// Passa in modalità produzione CON una configurazione di segreti valida, così
// la richiesta arriva davvero alla rotta invece di fermarsi a un 401: il test
// deve dimostrare che la scorciatoia non esiste, non che l'auth ha fallito.
const PROD_JWT_SECRET = 'segreto-di-produzione-lungo-e-non-di-default-0123456789';
const enterProduction = (u) => {
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = PROD_JWT_SECRET;
  process.env.STRIPE_SECRET_KEY = 'sk_live_chiaveveradiproduzione';
  return tokenFor(u, PROD_JWT_SECRET);
};

describe('FASE A — Sicurezza economica', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  beforeEach(async () => {
    savedEnv = {};
    ENV_KEYS.forEach((k) => { savedEnv[k] = process.env[k]; });

    await Promise.all([User.deleteMany({}), Character.deleteMany({}), Chat.deleteMany({}), Transaction.deleteMany({})]);
    user = await User.create({ email: 'paganti@example.com', username: 'paganti', credits: 0, authProvider: 'local' });
    token = tokenFor(user);
  });

  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    });
  });

  // ---- S0-1 ----------------------------------------------------------------
  describe('S0-1 — nessun credito senza pagamento in produzione', () => {
    it('il checkout in produzione non restituisce mai una sessione mock', async () => {
      const prodToken = enterProduction(user);
      const res = await request(app)
        .post('/api/payments/checkout')
        .set('Authorization', `Bearer ${prodToken}`)
        .send({ packageId: 'premium' });

      expect(res.status).not.toBe(401); // la rotta è stata raggiunta davvero
      expect(res.body.mode).not.toBe('mock');
      expect(res.body.transactionId).toBeUndefined();
    });

    it('la conferma manuale non esiste in produzione', async () => {
      const tx = await Transaction.create({
        userId: user._id, type: 'purchase', credits: 600, grossCents: 1499,
        stripePaymentIntentId: `pi_mock_${Date.now()}`, status: 'pending'
      });

      const prodToken = enterProduction(user);
      const res = await request(app)
        .post('/api/payments/confirm')
        .set('Authorization', `Bearer ${prodToken}`)
        .send({ transactionId: tx._id.toString() });

      expect(res.status).toBe(404);
      expect((await User.findById(user._id)).credits).toBe(0);
    });

    it('nessun credito viene accreditato dalla catena checkout+confirm in produzione', async () => {
      const prodToken = enterProduction(user);
      const checkout = await request(app)
        .post('/api/payments/checkout')
        .set('Authorization', `Bearer ${prodToken}`)
        .send({ packageId: 'premium' });

      if (checkout.body.transactionId) {
        await request(app)
          .post('/api/payments/confirm')
          .set('Authorization', `Bearer ${prodToken}`)
          .send({ transactionId: checkout.body.transactionId });
      }

      expect((await User.findById(user._id)).credits).toBe(0);
    });
  });

  // ---- S0-2 ----------------------------------------------------------------
  describe('S0-2 — nessun abbonamento gratis in produzione', () => {
    it('subscribe senza prezzo Stripe configurato non attiva nulla', async () => {
      const prodToken = enterProduction(user);
      delete process.env.STRIPE_PRICE_ANNUAL;

      const res = await request(app)
        .post('/api/payments/subscribe')
        .set('Authorization', `Bearer ${prodToken}`)
        .send({ plan: 'annual' });

      expect(res.status).not.toBe(401);

      expect(res.status).not.toBe(200);
      const after = await User.findById(user._id);
      expect(after.subscription).toBe('free');
      expect(after.subscriptionExpiresAt).toBeNull();
    });
  });

  // ---- S0-3 ----------------------------------------------------------------
  describe('S0-3 — la firma del webhook è sempre obbligatoria', () => {
    const forged = (userId) => JSON.stringify({
      type: 'payment_intent.succeeded',
      data: { object: { id: `pi_forged_${Date.now()}`, metadata: { userId, credits: '999999' } } }
    });

    it('un webhook non firmato viene rifiutato anche con segreto di esempio', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_sample';
      const res = await request(app)
        .post('/api/payments/webhook')
        .set('Content-Type', 'application/json')
        .send(forged(user._id.toString()));

      expect(res.status).toBe(400);
      expect((await User.findById(user._id)).credits).toBe(0);
    });

    it('un webhook non firmato viene rifiutato anche senza segreto configurato', async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      const res = await request(app)
        .post('/api/payments/webhook')
        .set('Content-Type', 'application/json')
        .send(forged(user._id.toString()));

      expect(res.status).toBe(400);
      expect((await User.findById(user._id)).credits).toBe(0);
    });

    it('una firma non valida viene rifiutata', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_segreto_reale_per_i_test';
      const res = await request(app)
        .post('/api/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 't=123,v1=firmainventata')
        .send(forged(user._id.toString()));

      expect(res.status).toBe(400);
      expect((await User.findById(user._id)).credits).toBe(0);
    });

    it('un webhook correttamente firmato viene accettato ed accredita una sola volta', async () => {
      const secret = 'whsec_test_segreto_reale_per_i_test';
      process.env.STRIPE_WEBHOOK_SECRET = secret;

      const intentId = 'pi_firmato_123';
      await Transaction.create({
        userId: user._id, type: 'purchase', credits: 50, grossCents: 299,
        stripePaymentIntentId: intentId, status: 'pending'
      });

      const payload = JSON.stringify({
        id: 'evt_1',
        type: 'payment_intent.succeeded',
        data: { object: { id: intentId, metadata: { userId: user._id.toString(), credits: '50' } } }
      });
      const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret });

      const first = await request(app)
        .post('/api/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', header)
        .send(payload);
      expect(first.status).toBe(200);
      expect((await User.findById(user._id)).credits).toBe(50);

      const second = await request(app)
        .post('/api/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', header)
        .send(payload);
      expect(second.status).toBe(200);
      expect((await User.findById(user._id)).credits).toBe(50);
    });

    it('un numero di crediti non plausibile non viene accreditato', async () => {
      const secret = 'whsec_test_segreto_reale_per_i_test';
      process.env.STRIPE_WEBHOOK_SECRET = secret;

      const payload = JSON.stringify({
        id: 'evt_2',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_nan_1', metadata: { userId: user._id.toString(), credits: 'moltissimi' } } }
      });
      const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret });

      await request(app)
        .post('/api/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', header)
        .send(payload);

      expect((await User.findById(user._id)).credits).toBe(0);
    });
  });

  // ---- S0-4 ----------------------------------------------------------------
  describe('S0-4 — la configurazione di produzione viene validata all avvio', () => {
    const validEnv = () => {
      process.env.NODE_ENV = 'production';
      process.env.MONGODB_URI = 'mongodb://database.example/app';
      process.env.FRONTEND_URL = 'https://app.example';
      process.env.JWT_SECRET = 'k'.repeat(48);
      process.env.STRIPE_SECRET_KEY = 'sk_live_chiaveveradiproduzione';
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_chiaveveradiproduzione';
      process.env.GEMINI_API_KEY = 'AIzaChiaveGeminiRealeDiProduzione';
      // Vendere richiede un'intestazione fiscale vera: una ricevuta senza
      // venditore non e' una ricevuta. Fanno parte della configurazione
      // completa tanto quanto le chiavi.
      process.env.SELLER_NAME = 'Esempio S.r.l.';
      process.env.SELLER_VAT_NUMBER = 'IT01234567890';
      process.env.SELLER_ADDRESS = 'Via Esempio 1, 20100 Milano (MI), Italia';
    };

    it('con i pagamenti accesi ma senza intestazione fiscale, l avvio viene rifiutato', () => {
      validEnv();
      delete process.env.SELLER_VAT_NUMBER;
      expect(() => assertProductionEnv()).toThrow(/SELLER_/);
    });

    it('con i pagamenti spenti l intestazione fiscale non serve: non si incassa nulla', () => {
      validEnv();
      delete process.env.SELLER_NAME;
      delete process.env.SELLER_VAT_NUMBER;
      delete process.env.SELLER_ADDRESS;
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_WEBHOOK_SECRET;
      process.env.FEATURE_PAYMENTS = 'false';
      process.env.FEATURE_SUBSCRIPTIONS = 'false';
      expect(() => assertProductionEnv()).not.toThrow();
    });

    it('gli abbonamenti accesi senza pagamenti sono una configurazione incoerente', () => {
      validEnv();
      process.env.FEATURE_PAYMENTS = 'false';
      process.env.FEATURE_SUBSCRIPTIONS = 'true';
      expect(() => assertProductionEnv()).toThrow(/FEATURE_SUBSCRIPTIONS/);
    });

    it('una configurazione completa passa la validazione', () => {
      validEnv();
      expect(() => assertProductionEnv()).not.toThrow();
    });

    it('il segreto JWT di default viene rifiutato', () => {
      validEnv();
      process.env.JWT_SECRET = 'your_character_super_secret_jwt_key_2026_secure';
      expect(() => assertProductionEnv()).toThrow(/JWT_SECRET/);
    });

    it('un segreto JWT troppo corto viene rifiutato', () => {
      validEnv();
      process.env.JWT_SECRET = 'corto';
      expect(() => assertProductionEnv()).toThrow(/JWT_SECRET/);
    });

    it('il segreto webhook di esempio viene rifiutato', () => {
      validEnv();
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_sample';
      expect(() => assertProductionEnv()).toThrow(/STRIPE_WEBHOOK_SECRET/);
    });

    it('una chiave Stripe segnaposto viene rifiutata', () => {
      validEnv();
      process.env.STRIPE_SECRET_KEY = 'sk_test_stripe_sample';
      expect(() => assertProductionEnv()).toThrow(/STRIPE_SECRET_KEY/);
    });

    // Stripe raccomanda le chiavi RISTRETTE (`rk_`) al posto di quelle segrete:
    // portano solo i permessi assegnati, quindi una fuga fa molto meno danno.
    // La guardia ammetteva solo `sk_`, così chi seguiva la raccomandazione si
    // vedeva rifiutare l'avvio del server — il contrario di ciò che serve.
    it('una chiave ristretta rk_ viene accettata come una sk_', () => {
      validEnv();
      process.env.STRIPE_SECRET_KEY = 'rk_live_chiaveristrettadiproduzione';
      expect(() => assertProductionEnv()).not.toThrow();
    });

    it('una chiave che non è né sk_ né rk_ viene rifiutata', () => {
      validEnv();
      process.env.STRIPE_SECRET_KEY = 'pk_live_questaepubblicanonsegreta';
      expect(() => assertProductionEnv()).toThrow(/STRIPE_SECRET_KEY/);
    });

    it('una chiave Gemini mancante viene rifiutata', () => {
      validEnv();
      delete process.env.GEMINI_API_KEY;
      expect(() => assertProductionEnv()).toThrow(/GEMINI_API_KEY/);
    });

    it('un NODE_ENV dimenticato viene trattato come produzione, non come sviluppo', () => {
      validEnv();
      delete process.env.NODE_ENV;
      // La configurazione è valida, quindi non deve lanciare...
      expect(() => assertProductionEnv()).not.toThrow();

      // ...ma le guardie devono essere attive lo stesso.
      process.env.JWT_SECRET = 'your_character_super_secret_jwt_key_2026_secure';
      expect(() => assertProductionEnv()).toThrow(/JWT_SECRET/);
    });

    it('con NODE_ENV assente i pagamenti simulati restano disattivati', async () => {
      delete process.env.NODE_ENV;
      process.env.STRIPE_SECRET_KEY = 'sk_test_stripe_sample';
      const { mockPaymentsEnabled } = require('../config/env');
      expect(mockPaymentsEnabled()).toBe(false);
    });

    it('l errore elenca tutti i problemi insieme, non solo il primo', () => {
      validEnv();
      process.env.JWT_SECRET = 'corto';
      delete process.env.GEMINI_API_KEY;
      expect(() => assertProductionEnv()).toThrow(/JWT_SECRET[\s\S]*GEMINI_API_KEY|GEMINI_API_KEY[\s\S]*JWT_SECRET/);
    });
  });

  // ---- Anti-regressione sul percorso di avvio -----------------------------
  describe('S0-4 — la validazione è collegata al percorso di avvio, non solo esistente', () => {
    it('bootstrap() rifiuta di avviarsi con una configurazione di produzione incompleta', async () => {
      process.env.NODE_ENV = 'production';
      process.env.MONGODB_URI = 'mongodb://database.example/app';
      process.env.FRONTEND_URL = 'https://app.example';
      process.env.JWT_SECRET = 'your_character_super_secret_jwt_key_2026_secure'; // quello di default
      process.env.STRIPE_SECRET_KEY = 'sk_live_chiaveveradiproduzione';
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_chiaveveradiproduzione';
      process.env.GEMINI_API_KEY = 'AIzaChiaveGeminiRealeDiProduzione';

      // Se qualcuno rimuove `assertProductionEnv()` da server.js, bootstrap()
      // proverebbe a connettersi al database invece di fallire subito: questo
      // test se ne accorge, mentre chiamare la funzione direttamente no.
      await expect(app.bootstrap()).rejects.toThrow(/JWT_SECRET/);
    });

    it('server.js espone bootstrap(), il percorso realmente eseguito all avvio', () => {
      expect(typeof app.bootstrap).toBe('function');
    });
  });

  // ---- S0-9 ----------------------------------------------------------------
  describe('S0-9 — una risposta simulata non viene fatturata', () => {
    let chat;

    beforeEach(async () => {
      await User.findByIdAndUpdate(user._id, { credits: 20 });
      const character = await Character.create({
        name: 'Compagno di prova',
        description: 'Personaggio usato per verificare la fatturazione delle risposte.',
        personality: 'Risponde in modo prevedibile per rendere verificabile il conteggio dei crediti.',
        avatar: 'https://example.com/test.jpg',
        isPublic: true,
        createdBy: user._id
      });
      chat = await Chat.create({ userId: user._id, characterId: character._id });
    });

    it('in modalità degradata il messaggio non costa crediti ed è marcato come simulato', async () => {
      process.env.AI_MODE = 'degraded';
      const res = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${token}`)
        .send({ chatId: chat._id.toString(), content: 'Ciao, come stai oggi?' });
      delete process.env.AI_MODE;

      expect(res.status).toBe(200);
      expect(res.body.aiMessage.simulated).toBe(true);
      expect(res.body.user.credits).toBe(20);
      expect((await User.findById(user._id)).credits).toBe(20);
    });

    it('in modalità degradata l immagine non costa crediti', async () => {
      process.env.AI_MODE = 'degraded';
      const res = await request(app)
        .post('/api/images/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({ chatId: chat._id.toString(), prompt: 'un drago rosso sopra una montagna innevata' });
      delete process.env.AI_MODE;

      expect(res.status).toBe(200);
      expect(res.body.message.simulated).toBe(true);
      expect((await User.findById(user._id)).credits).toBe(20);
    });
  });
});
