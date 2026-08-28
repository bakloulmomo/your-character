/**
 * Le sospensioni a termine devono scadere davvero.
 *
 * `banExpiresAt` veniva scritto dall'amministratore e mostrato all'utente nel
 * messaggio di blocco, ma non veniva letto da nessuna parte: una sospensione
 * di sette giorni era perpetua, e la data comunicata una promessa mai
 * mantenuta. Nessun test se ne era accorto perche' nessuno arriva mai
 * all'ottavo giorno — a meno di scriverne uno che ci arriva.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');
const { applyBanExpiry } = require('../utils/time');

let mongoServer;

const tokenFor = (u) =>
  jwt.sign({ id: u._id, email: u.email, username: u.username, tv: u.tokenVersion || 0 },
    process.env.JWT_SECRET, { expiresIn: '1h' });

const giorniFa = (n) => new Date(Date.now() - n * 24 * 3600 * 1000);
const giorniAvanti = (n) => new Date(Date.now() + n * 24 * 3600 * 1000);

const creaUtente = (extra) => User.create({
  email: 'sospeso@example.com', username: 'sospeso', authProvider: 'local',
  birthdate: new Date('1990-01-01'), ...extra
});

describe('Scadenza delle sospensioni', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  beforeEach(async () => { await User.deleteMany({}); });

  it('una sospensione scaduta viene revocata e l utente rientra', async () => {
    const u = await creaUtente({
      isBanned: true, banReason: 'Test', banExpiresAt: giorniFa(1)
    });

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenFor(u)}`);
    expect(res.status).toBe(200);

    const dopo = await User.findById(u._id);
    expect(dopo.isBanned).toBe(false);
    expect(dopo.banExpiresAt).toBeNull();
    expect(dopo.banReason).toBeNull();
  });

  it('una sospensione ancora in corso resta in vigore', async () => {
    const u = await creaUtente({
      isBanned: true, banReason: 'Test', banExpiresAt: giorniAvanti(3)
    });

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenFor(u)}`);
    expect(res.status).toBe(403);
    expect((await User.findById(u._id)).isBanned).toBe(true);
  });

  it('una sospensione SENZA data non scade mai: e permanente per definizione', async () => {
    const u = await creaUtente({ isBanned: true, banReason: 'Grave', banExpiresAt: null });

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenFor(u)}`);
    expect(res.status).toBe(403);
    expect((await User.findById(u._id)).isBanned).toBe(true);
  });

  it('la revoca riapre anche le rotte del prodotto, non solo il profilo', async () => {
    const u = await creaUtente({
      isBanned: true, banReason: 'Test', banExpiresAt: giorniFa(1), credits: 10
    });

    const res = await request(app).get('/api/chats').set('Authorization', `Bearer ${tokenFor(u)}`);
    expect(res.status).toBe(200);
  });

  it('applyBanExpiry dice se ha agito, cosi chi la chiama puo registrarlo', async () => {
    const scaduto = await creaUtente({ isBanned: true, banExpiresAt: giorniFa(1) });
    expect(await applyBanExpiry(scaduto)).toBe(true);

    const attivo = await creaUtente({
      email: 'a@b.it', username: 'attivo', isBanned: true, banExpiresAt: giorniAvanti(1)
    });
    expect(await applyBanExpiry(attivo)).toBe(false);

    const libero = await creaUtente({ email: 'c@d.it', username: 'libero' });
    expect(await applyBanExpiry(libero)).toBe(false);
  });
});
