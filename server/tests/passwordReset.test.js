/**
 * FASE C.8 — Recupero password (S2-10).
 * Prima non esisteva: chi dimenticava la password restava escluso per sempre.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');

let mongoServer;
const CREDENTIALS = {
  email: 'recupero@example.com',
  username: 'recupero',
  password: 'PasswordVecchia1',
  birthdate: '1990-06-15'
};

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

describe('FASE C — Recupero password', () => {
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
    await request(app).post('/api/auth/register').send(CREDENTIALS);
  });

  /** Legge il token generato dal database, come farebbe l'utente dalla mail. */
  const issueToken = async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: CREDENTIALS.email });
    const user = await User.findOne({ email: CREDENTIALS.email }).select('+passwordResetTokenHash');

    // Si ricostruisce il token provando l'impronta: nel test si genera un
    // token noto e lo si scrive, perché il token in chiaro non è recuperabile.
    const token = crypto.randomBytes(32).toString('hex');
    user.passwordResetTokenHash = hashToken(token);
    user.passwordResetExpiresAt = new Date(Date.now() + 3600_000);
    await user.save();
    return token;
  };

  it('la richiesta non rivela se l indirizzo è registrato', async () => {
    const known = await request(app).post('/api/auth/forgot-password').send({ email: CREDENTIALS.email });
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'nessuno@example.com' });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
  });

  it('il token in chiaro non viene mai salvato nel database', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: CREDENTIALS.email });
    // Entrambi i campi sono `select: false`: vanno chiesti esplicitamente.
    const user = await User.findOne({ email: CREDENTIALS.email })
      .select('+passwordResetTokenHash +passwordResetExpiresAt');

    expect(user.passwordResetTokenHash).toMatch(/^[0-9a-f]{64}$/); // è un'impronta
    expect(user.passwordResetExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('con un token valido la password viene cambiata e si può accedere', async () => {
    const token = await issueToken();

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'PasswordNuova1' });
    expect(reset.status).toBe(200);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: CREDENTIALS.email, password: 'PasswordNuova1' });
    expect(login.status).toBe(200);

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: CREDENTIALS.email, password: CREDENTIALS.password });
    expect(oldLogin.status).toBe(401);
  });

  it('il token si può usare una sola volta', async () => {
    const token = await issueToken();
    await request(app).post('/api/auth/reset-password').send({ token, password: 'PasswordNuova1' });

    const second = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'AltraPassword1' });
    expect(second.status).toBe(400);
  });

  it('un token scaduto viene rifiutato', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const user = await User.findOne({ email: CREDENTIALS.email });
    user.passwordResetTokenHash = hashToken(token);
    user.passwordResetExpiresAt = new Date(Date.now() - 1000);
    await user.save();

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'PasswordNuova1' });
    expect(res.status).toBe(400);
  });

  it('un token inventato viene rifiutato', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'token-inventato', password: 'PasswordNuova1' });
    expect(res.status).toBe(400);
  });

  it('una password debole viene rifiutata con un messaggio utile', async () => {
    const token = await issueToken();
    const res = await request(app).post('/api/auth/reset-password').send({ token, password: 'corta' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('8 caratteri');
  });

  it('cambiare password chiude le sessioni già aperte', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: CREDENTIALS.email, password: CREDENTIALS.password });
    const oldToken = login.body.token;

    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`)).status).toBe(200);

    const token = await issueToken();
    await request(app).post('/api/auth/reset-password').send({ token, password: 'PasswordNuova1' });

    const after = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`);
    expect(after.status).toBe(401);
  });
});
