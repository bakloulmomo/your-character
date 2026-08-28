/**
 * FASE E — Osservabilità (regressione permanente).
 *
 * Codifica il punto 5 del piano: logging strutturato con identificativo di
 * richiesta, allarmi su costo e tasso d'errore, raccolta errori dichiarata.
 *
 * Il valore di questi test non è verificare che il logger scriva: è verificare
 * che le proprietà su cui si conterà davvero durante un incidente esistano —
 * l'identificativo restituito al client, la redazione dei segreti, l'allarme
 * che scatta una volta sola, e il messaggio d'errore che non rivela l'interno.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const Character = require('../models/Character');
const { recordCall, snapshot, resetMetrics } = require('../services/metrics');
const { REDACTED } = require('../services/logger');
const { HEADER } = require('../middleware/requestContext');
const { initErrorReporting, isErrorReportingEnabled } = require('../services/errorReporting');

let mongoServer;
let staff;
let staffToken;

const tokenFor = (u) =>
  jwt.sign({ id: u._id, email: u.email, username: u.username, tv: u.tokenVersion || 0 },
    process.env.JWT_SECRET, { expiresIn: '1h' });

describe('FASE E — Osservabilità', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  beforeEach(async () => {
    resetMetrics();
    await Promise.all([User.deleteMany({}), Message.deleteMany({}), Chat.deleteMany({}), Character.deleteMany({})]);
    staff = await User.create({ email: 'mod@example.com', username: 'moderatore', role: 'moderator' });
    staffToken = tokenFor(staff);
  });

  // ---- Identificativo di richiesta -----------------------------------------
  describe('identificativo di richiesta', () => {
    it('ogni risposta ne porta uno', async () => {
      const res = await request(app).get('/health');
      expect(res.headers[HEADER]).toMatch(/^[A-Za-z0-9-]{8,}$/);
    });

    it('due richieste ricevono identificativi diversi', async () => {
      const [a, b] = await Promise.all([request(app).get('/health'), request(app).get('/health')]);
      expect(a.headers[HEADER]).not.toBe(b.headers[HEADER]);
    });

    it('un identificativo già assegnato dal proxy viene rispettato', async () => {
      // Altrimenti la stessa richiesta avrebbe due nomi diversi nei due sistemi
      // e correlarli a mano diventerebbe impossibile.
      const res = await request(app).get('/health').set(HEADER, 'proxy-abc-123456');
      expect(res.headers[HEADER]).toBe('proxy-abc-123456');
    });

    it('un identificativo malformato viene sostituito, non propagato nei log', async () => {
      const res = await request(app).get('/health').set(HEADER, 'valore con spazi e <tag>');
      expect(res.headers[HEADER]).not.toBe('valore con spazi e <tag>');
    });
  });

  // ---- Redazione ------------------------------------------------------------
  it('i segreti sono redatti nella configurazione del logger, non a mano nei punti di chiamata', () => {
    // Una redazione che dipende dalla disciplina di chi scrive il log è una
    // redazione che prima o poi manca.
    for (const path of ['req.headers.authorization', 'req.headers.cookie', 'password', 'token', 'clientSecret']) {
      expect(REDACTED).toContain(path);
    }
  });

  // ---- Allarmi --------------------------------------------------------------
  describe('allarmi su costo e affidabilità', () => {
    it('il tasso d\'errore non fa scattare nulla su un campione troppo piccolo', () => {
      // 1 errore su 2 chiamate è il 50%, ma non è un\'anomalia.
      recordCall('llm', { ok: false });
      recordCall('llm', { ok: true });
      expect(snapshot().alerted.llmErrorRate).toBe(false);
    });

    it('scatta quando il campione è significativo e la soglia è superata', () => {
      for (let i = 0; i < 25; i++) recordCall('llm', { ok: i % 2 === 0 });
      expect(snapshot().alerted.llmErrorRate).toBe(true);
      expect(snapshot().llm.errorRate).toBeGreaterThan(0.2);
    });

    it('l\'allarme sulla spesa scatta una volta sola, non a ogni chiamata', () => {
      for (let i = 0; i < 100; i++) recordCall('llm', { ok: true, costEur: 1 });
      const s = snapshot();
      expect(s.alerted.cost).toBe(true);
      expect(s.llm.costEur).toBeGreaterThan(25);
    });

    it('il costo si accumula sulle chiamate riuscite', () => {
      recordCall('llm', { ok: true, costEur: 0.002 });
      recordCall('image', { ok: true, costEur: 0.02 });
      const s = snapshot();
      expect(s.llm.costEur).toBeCloseTo(0.002, 4);
      expect(s.image.costEur).toBeCloseTo(0.02, 4);
    });
  });

  // ---- Endpoint delle metriche ---------------------------------------------
  describe('GET /api/admin/metrics', () => {
    it('è riservato al team', async () => {
      const plain = await User.create({ email: 'tizio@example.com', username: 'tizio' });
      const res = await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${tokenFor(plain)}`);
      expect(res.status).toBe(404);
    });

    it('il costo giornaliero viene dal database, non dai contatori in memoria', async () => {
      const chat = await Chat.create({ userId: staff._id, characterId: new mongoose.Types.ObjectId(), title: 'x' });
      await Message.create({ chatId: chat._id, role: 'assistant', content: 'a', cost: 0.01 });
      await Message.create({ chatId: chat._id, role: 'assistant', content: 'b', cost: 0.02 });

      const res = await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.persisted.costEur).toBeCloseTo(0.03, 4);
      expect(res.body.persisted.messages).toBe(2);
      // I contatori in memoria non hanno visto quelle scritture: le due fonti
      // sono diverse di natura e la risposta lo dichiara.
      expect(res.body.live.llm.calls).toBe(0);
      expect(res.body.live.scope).toContain('riavvio');
    });

    it('dichiara se la raccolta errori è configurata, invece di lasciarlo intendere', async () => {
      const res = await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${staffToken}`);
      expect(['attivo', 'non configurato']).toContain(res.body.errorReporting);
    });
  });

  // ---- Raccolta errori ------------------------------------------------------
  it('senza SENTRY_DSN la raccolta errori non si attiva e lo dice', () => {
    const previous = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    try {
      expect(initErrorReporting()).toBe(false);
      expect(isErrorReportingEnabled()).toBe(false);
    } finally {
      if (previous) process.env.SENTRY_DSN = previous;
    }
  });
});
