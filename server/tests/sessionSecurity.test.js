/**
 * Sessione, blocco e cambio password.
 *
 * Tre difese che prima non c'erano, e una che c'era ma non veniva mai
 * raggiunta: la scadenza delle sospensioni sul percorso di accesso. Quel
 * difetto era invisibile per costruzione — per vederlo bisogna arrivare
 * all'ottavo giorno di una sospensione di sette.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');
const { signSession, SESSION_RENEW_BELOW_MS } = require('../services/session');

let mongoServer;

const PASSWORD = 'Password1';

const creaUtente = async (extra = {}) => User.create({
  email: 'tizio@example.com',
  username: 'tizio',
  authProvider: 'local',
  passwordHash: await bcrypt.hash(PASSWORD, 4),
  birthdate: new Date('1990-01-01'),
  emailVerifiedAt: new Date(),
  ...extra
});

const accedi = (password = PASSWORD, email = 'tizio@example.com') =>
  request(app).post('/api/auth/login').send({ email, password });

describe('Sicurezza della sessione', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  beforeEach(async () => { await User.deleteMany({}); });

  // ── Sospensioni ───────────────────────────────────────────────────────────
  describe('Sospensioni a termine', () => {
    /**
     * IL DIFETTO. `applyBanExpiry` viveva solo nel middleware che risolve una
     * sessione esistente. Ma chi e' sospeso non ha una sessione — gliela
     * abbiamo tolta al momento del ban — quindi passava di qui, dove la
     * scadenza non veniva mai guardata: ogni sospensione «di sette giorni» era
     * perpetua.
     */
    it('una sospensione scaduta lascia rientrare dal login', async () => {
      await creaUtente({
        isBanned: true,
        banReason: 'prova',
        banExpiresAt: new Date(Date.now() - 24 * 3600 * 1000)
      });

      const res = await accedi();

      expect(res.status).toBe(200);
      expect((await User.findOne({ email: 'tizio@example.com' })).isBanned).toBe(false);
    });

    it('una sospensione ancora valida continua a tenere fuori', async () => {
      await creaUtente({
        isBanned: true,
        banReason: 'prova',
        banExpiresAt: new Date(Date.now() + 24 * 3600 * 1000)
      });

      const res = await accedi();

      expect(res.status).toBe(403);
      expect(res.body.until).toBeDefined();
    });

    it('una sospensione senza scadenza resta permanente', async () => {
      await creaUtente({ isBanned: true, banReason: 'grave', banExpiresAt: null });

      expect((await accedi()).status).toBe(403);
    });
  });

  // ── Blocco per account ────────────────────────────────────────────────────
  describe('Blocco dopo troppi tentativi', () => {
    it('conta i tentativi falliti sull account, non solo sull indirizzo IP', async () => {
      const u = await creaUtente();

      await accedi('Sbagliata1');
      await accedi('Sbagliata2');

      const dopo = await User.findById(u._id).select('+failedLoginAttempts');
      expect(dopo.failedLoginAttempts).toBe(2);
    });

    it('dopo dieci errori blocca, e la password GIUSTA non entra', async () => {
      const u = await creaUtente();

      for (let i = 0; i < 10; i++) await accedi('Sbagliata1');

      const bloccato = await User.findById(u._id).select('+lockedUntil');
      expect(bloccato.lockedUntil).toBeInstanceOf(Date);
      expect((await accedi()).status).toBe(401);
    });

    /**
     * Il blocco non deve diventare un oracolo: se rispondesse diversamente da
     * «credenziali non valide», confermerebbe quali indirizzi hanno un account.
     */
    it('il messaggio è identico a quello di una password sbagliata', async () => {
      const u = await creaUtente();
      for (let i = 0; i < 10; i++) await accedi('Sbagliata1');

      const bloccato = await accedi();
      const inesistente = await accedi(PASSWORD, 'nessuno@example.com');

      expect(bloccato.body).toEqual(inesistente.body);
      expect(u).toBeDefined();
    });

    it('un accesso riuscito azzera il conto', async () => {
      const u = await creaUtente();
      await accedi('Sbagliata1');
      await accedi('Sbagliata1');

      await accedi();

      const dopo = await User.findById(u._id).select('+failedLoginAttempts +lockedUntil');
      expect(dopo.failedLoginAttempts).toBe(0);
      expect(dopo.lockedUntil).toBeNull();
    });

    it('scaduto il blocco si rientra', async () => {
      const u = await creaUtente({ lockedUntil: new Date(Date.now() - 1000) });

      expect((await accedi()).status).toBe(200);
      expect(u).toBeDefined();
    });
  });

  // ── Rotazione ─────────────────────────────────────────────────────────────
  describe('Rinnovo silenzioso della sessione', () => {
    it('un token prossimo alla scadenza viene rinnovato nel cookie', async () => {
      const u = await creaUtente();
      // Un token che scade fra un'ora: sotto la soglia di rinnovo.
      const quasiScaduto = jwt.sign(
        { id: u._id, email: u.email, username: u.username, tv: 0 },
        process.env.JWT_SECRET, { expiresIn: '1h' }
      );

      const res = await request(app).get('/api/auth/me')
        .set('Authorization', `Bearer ${quasiScaduto}`);

      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']).toBeDefined();
      expect(String(res.headers['set-cookie'])).toContain('yc_token=');
    });

    it('un token ancora fresco NON viene rinnovato a ogni richiesta', async () => {
      // Altrimenti ci sarebbe un Set-Cookie su ogni risposta, per nulla.
      const u = await creaUtente();
      const fresco = signSession(u);

      const res = await request(app).get('/api/auth/me')
        .set('Authorization', `Bearer ${fresco}`);

      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(SESSION_RENEW_BELOW_MS).toBeGreaterThan(0);
    });
  });

  // ── Cambio password ───────────────────────────────────────────────────────
  describe('Cambio password da dentro', () => {
    const cambia = (token, corpo) =>
      request(app).patch('/api/auth/password').set('Authorization', `Bearer ${token}`).send(corpo);

    it('richiede la password attuale', async () => {
      const u = await creaUtente();
      const res = await cambia(signSession(u), { currentPassword: 'Sbagliata1', newPassword: 'Nuova1234' });

      expect(res.status).toBe(401);
    });

    it('cambia la password e disconnette gli altri dispositivi', async () => {
      const u = await creaUtente();
      const vecchioToken = signSession(u);

      const res = await cambia(vecchioToken, { currentPassword: PASSWORD, newPassword: 'Nuova1234' });

      expect(res.status).toBe(200);
      // Il vecchio token non vale più: `tokenVersion` è cambiata.
      const conVecchio = await request(app).get('/api/auth/me')
        .set('Authorization', `Bearer ${vecchioToken}`);
      expect(conVecchio.status).toBe(401);
      // Ma chi ha fatto il cambio resta dentro, con il token nuovo.
      const conNuovo = await request(app).get('/api/auth/me')
        .set('Authorization', `Bearer ${res.body.token}`);
      expect(conNuovo.status).toBe(200);
    });

    it('applica le stesse regole della registrazione', async () => {
      const u = await creaUtente();
      const res = await cambia(signSession(u), { currentPassword: PASSWORD, newPassword: 'corta' });

      expect(res.status).toBe(400);
    });

    it('rifiuta una password identica a quella attuale', async () => {
      const u = await creaUtente();
      const res = await cambia(signSession(u), { currentPassword: PASSWORD, newPassword: PASSWORD });

      expect(res.status).toBe(400);
    });

    it('senza sessione non si cambia nulla', async () => {
      const res = await request(app).patch('/api/auth/password')
        .send({ currentPassword: PASSWORD, newPassword: 'Nuova1234' });

      expect(res.status).toBe(401);
    });
  });
});
