/**
 * FASE D — Conformità: intestazioni di sicurezza e consenso ai cookie
 * (S2-15, S2-6).
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');

let mongoServer;
let user;
let token;

const tokenFor = (u) =>
  jwt.sign({ id: u._id, email: u.email, username: u.username, tv: u.tokenVersion || 0 },
    process.env.JWT_SECRET, { expiresIn: '1h' });

describe('FASE D — Conformità', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  beforeEach(async () => {
    await User.deleteMany({});
    user = await User.create({ email: 'conforme@example.com', username: 'conforme', birthdate: new Date('1990-01-01') });
    token = tokenFor(user);
  });

  // ---- S2-15 ---------------------------------------------------------------
  describe('S2-15 — la CSP non è più disattivata', () => {
    it('ogni risposta porta una Content-Security-Policy', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['content-security-policy']).toBeDefined();
    });

    it('la policy nega tutto per default e vieta gli script: questa API non ne esegue', async () => {
      const csp = (await request(app).get('/health')).headers['content-security-policy'];
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
    });

    it('le immagini generate restano caricabili dal client, che sta su un\'altra origine', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    it('restano attive le altre intestazioni di helmet', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });
  });

  // ---- S2-6 ----------------------------------------------------------------
  describe('S2-6 — il consenso ai cookie viene registrato, non solo scritto nel browser', () => {
    it('la scelta viene salvata sull\'account con data e versione', async () => {
      const res = await request(app)
        .patch('/api/users/me/preferences')
        .set('Authorization', `Bearer ${token}`)
        .send({ cookieConsent: { functional: false, version: '2026-08-28' } });

      expect(res.status).toBe(200);

      const saved = await User.findById(user._id);
      expect(saved.cookieConsent.functional).toBe(false);
      expect(saved.cookieConsent.version).toBe('2026-08-28');
      expect(saved.cookieConsent.updatedAt).toBeInstanceOf(Date);
    });

    it('la scelta viene restituita al client, così sopravvive al cambio di dispositivo', async () => {
      await request(app)
        .patch('/api/users/me/preferences')
        .set('Authorization', `Bearer ${token}`)
        .send({ cookieConsent: { functional: true, version: '2026-08-28' } });

      const me = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
      expect(me.body.user.cookieConsent.functional).toBe(true);
    });

    it('il rifiuto è registrato come una scelta, non come un\'assenza di scelta', async () => {
      await request(app)
        .patch('/api/users/me/preferences')
        .set('Authorization', `Bearer ${token}`)
        .send({ cookieConsent: { functional: false, version: '2026-08-28' } });

      const saved = await User.findById(user._id);
      expect(saved.cookieConsent.version).toBe('2026-08-28');
      expect(saved.cookieConsent.updatedAt).not.toBeNull();
    });
  });

  // ---- Export GDPR ---------------------------------------------------------
  it('l\'export GDPR include consensi e segnalazioni, non solo profilo e chat', async () => {
    const res = await request(app)
      .get('/api/users/me/export')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('consents');
    expect(res.body).toHaveProperty('reportsSubmitted');
    expect(res.body.userProfile).toHaveProperty('birthdate');
  });
});
