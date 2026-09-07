/**
 * S1 — Un privilegio non nasce da un dato che l'utente stesso fornisce.
 *
 * `applyAdminBootstrap` promuoveva a `admin` chiunque si registrasse (o
 * accedesse) con un indirizzo presente in `ADMIN_EMAILS`. Non esiste alcuna
 * verifica dell'email: nessun token di conferma, nessun campo `emailVerified`.
 * `ADMIN_EMAILS` viene configurata al primo deploy, PRIMA che l'account del
 * titolare esista, ed è tipicamente l'indirizzo pubblico del progetto — quindi
 * chi arrivava per primo si prendeva la coda di moderazione, le email di tutti
 * gli iscritti, il `systemPrompt` di ogni personaggio e il potere di sospendere
 * account.
 *
 * Due prove, non una: il difetto sopravviveva a mezza correzione. Spostare la
 * promozione al solo accesso non chiudeva nulla, perché chi si registra poi
 * entra — ed è il secondo test qui sotto a dirlo.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');

let mongoServer;

const VITTIMA = 'titolare@your-character.app';
const CREDENZIALI = {
  email: VITTIMA,
  username: 'nonsonoiltitolare',
  password: 'Password1',
  birthdate: '1990-01-01'
};

describe('S1 — ADMIN_EMAILS non concede privilegi', () => {
  beforeAll(async () => {
    // `adminEmails()` legge l'ambiente a ogni chiamata: impostarla qui basta,
    // e mette il test nella condizione peggiore possibile per il server.
    process.env.ADMIN_EMAILS = VITTIMA;

    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    delete process.env.ADMIN_EMAILS;
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  beforeEach(async () => {
    await User.deleteMany({});
  });

  it('registrarsi con l\'indirizzo in ADMIN_EMAILS non rende amministratori', async () => {
    const res = await request(app).post('/api/auth/register').send(CREDENZIALI);

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('user');

    const scritto = await User.findOne({ email: VITTIMA });
    expect(scritto.role).toBe('user');
  });

  it('e nemmeno accedere dopo essersi registrati', async () => {
    await request(app).post('/api/auth/register').send(CREDENZIALI).expect(201);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VITTIMA, password: CREDENZIALI.password });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('user');

    const scritto = await User.findOne({ email: VITTIMA });
    expect(scritto.role).toBe('user');
  });

  it('quel conto non apre il pannello di amministrazione', async () => {
    const registrazione = await request(app).post('/api/auth/register').send(CREDENZIALI).expect(201);

    // 404, non 403: il pannello non rivela nemmeno di esistere.
    await request(app)
      .get('/api/admin/reports')
      .set('Authorization', `Bearer ${registrazione.body.token}`)
      .expect(404);
  });

  it('il ruolo concesso fuori banda continua a funzionare', async () => {
    const registrazione = await request(app).post('/api/auth/register').send(CREDENZIALI).expect(201);

    // È ciò che fa `scripts/grantRole.js`: richiede l'accesso al database.
    await User.updateOne({ email: VITTIMA }, { role: 'admin' });

    await request(app)
      .get('/api/admin/reports')
      .set('Authorization', `Bearer ${registrazione.body.token}`)
      .expect(200);
  });
});
