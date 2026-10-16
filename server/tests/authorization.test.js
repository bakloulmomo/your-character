/**
 * FASE A — Test di autorizzazione (regressione permanente).
 *
 * Codifica i difetti S0-5, S0-6, S0-8 e S2-4 del piano QA:
 * un personaggio privato deve restare privato, un id sconosciuto deve dare 404
 * (non un personaggio a caso), e il logout deve chiudere davvero la sessione.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');
const Character = require('../models/Character');
const Chat = require('../models/Chat');

let mongoServer;
let owner;
let stranger;
let strangerToken;
let privateCharacter;
let publicCharacter;

const tokenFor = (user) =>
  jwt.sign(
    { id: user._id, email: user.email, username: user.username, tv: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

describe('FASE A — Autorizzazione e isolamento dei personaggi privati', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Character.deleteMany({}), Chat.deleteMany({})]);

    owner = await User.create({
    emailVerifiedAt: new Date(), email: 'owner@example.com', username: 'owner', authProvider: 'local' });
    stranger = await User.create({
    emailVerifiedAt: new Date(), email: 'stranger@example.com', username: 'stranger', authProvider: 'local' });
    strangerToken = tokenFor(stranger);

    privateCharacter = await Character.create({
      name: 'Confidente Privato',
      description: 'Personaggio privato creato per uso strettamente personale.',
      personality: 'Conserva confidenze personali che non devono uscire dall account del creatore.',
      avatar: 'https://example.com/private.jpg',
      isPublic: false,
      createdBy: owner._id
    });

    publicCharacter = await Character.create({
      name: 'Guida Pubblica',
      description: 'Personaggio pubblico visibile in galleria a chiunque.',
      personality: 'Accogliente e disponibile con chiunque apra una conversazione nuova.',
      avatar: 'https://example.com/public.jpg',
      isPublic: true,
      // Dalla FASE D un personaggio pubblico nasce in attesa di revisione: la
      // fixture rappresenta un personaggio già approvato, e deve dirlo.
      moderationStatus: 'approved',
      createdBy: owner._id
    });
  });

  // ---- S0-5 ----------------------------------------------------------------
  it('S0-5 — un visitatore anonimo non può leggere un personaggio privato', async () => {
    const res = await request(app).get(`/api/characters/${privateCharacter._id}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Confidente Privato');
  });

  it('S0-5 — un utente autenticato non può leggere il personaggio privato di un altro', async () => {
    const res = await request(app)
      .get(`/api/characters/${privateCharacter._id}`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(res.status).toBe(404);
  });

  it('S0-5 — il proprietario legge il proprio personaggio privato', async () => {
    const res = await request(app)
      .get(`/api/characters/${privateCharacter._id}`)
      .set('Authorization', `Bearer ${tokenFor(owner)}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Confidente Privato');
  });

  it('S0-5 — il systemPrompt non viene mai esposto dalla API pubblica', async () => {
    const res = await request(app).get(`/api/characters/${publicCharacter._id}`);
    expect(res.status).toBe(200);
    expect(res.body.systemPrompt).toBeUndefined();

    const list = await request(app).get('/api/characters');
    list.body.characters.forEach((c) => expect(c.systemPrompt).toBeUndefined());
  });

  // ---- S0-6 ----------------------------------------------------------------
  it('S0-6 — non si può aprire una chat con il personaggio privato di un altro', async () => {
    const res = await request(app)
      .post('/api/chats')
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ characterId: privateCharacter._id.toString() });

    expect(res.status).toBe(404);
    expect(await Chat.countDocuments({})).toBe(0);
  });

  it('S0-6 — il proprietario può aprire una chat con il proprio personaggio privato', async () => {
    const res = await request(app)
      .post('/api/chats')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ characterId: privateCharacter._id.toString() });

    expect(res.status).toBe(201);
  });

  it('S0-6 — chiunque può aprire una chat con un personaggio pubblico', async () => {
    const res = await request(app)
      .post('/api/chats')
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ characterId: publicCharacter._id.toString() });

    expect(res.status).toBe(201);
  });

  // ---- S2-4: niente dati inventati -----------------------------------------
  it('S2-4 — un id inesistente dà 404, non un personaggio di ripiego', async () => {
    const res = await request(app).get('/api/characters/507f1f77bcf86cd799439011');
    expect(res.status).toBe(404);
  });

  it('S2-4 — un id malformato dà 400, non un personaggio di ripiego', async () => {
    const res = await request(app).get('/api/characters/non-e-un-objectid');
    expect(res.status).toBe(400);
  });

  it('S2-4 — una ricerca senza risultati restituisce una lista vuota', async () => {
    const res = await request(app).get('/api/characters?search=zzzzqqqqinesistente');
    expect(res.status).toBe(200);
    expect(res.body.characters).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  // Regressione trovata durante la Fase A: la ricerca dipendeva da un indice
  // testuale, quindi la PRIMA ricerca su un database nuovo restituiva 500.
  it('la ricerca funziona su un database appena creato, senza indici già pronti', async () => {
    await Character.collection.drop().catch(() => {});
    await Character.create({
      name: 'Marcus Vance',
      description: 'Netrunner in una metropoli distopica.',
      personality: 'Cinico e astuto, sempre alla ricerca della prossima breccia nei sistemi.',
      avatar: 'https://example.com/marcus.jpg',
      isPublic: true,
      moderationStatus: 'approved',
      createdBy: owner._id
    });

    const res = await request(app).get('/api/characters?search=Marcus');
    expect(res.status).toBe(200);
    expect(res.body.characters).toHaveLength(1);
  });

  it('la ricerca trova per sottostringa, come ci si aspetta digitando', async () => {
    const res = await request(app).get('/api/characters?search=uida');
    expect(res.status).toBe(200);
    expect(res.body.characters.map((c) => c.name)).toContain('Guida Pubblica');
  });

  it('la ricerca non restituisce personaggi privati di altri utenti', async () => {
    const res = await request(app).get('/api/characters?search=Confidente');
    expect(res.body.characters).toEqual([]);
  });

  it('un termine di ricerca con metacaratteri regex non blocca il server', async () => {
    const res = await request(app).get(`/api/characters?search=${encodeURIComponent('(a+)+$')}`);
    expect(res.status).toBe(200);
    expect(res.body.characters).toEqual([]);
  });

  it('S2-4 — un database senza personaggi pubblici restituisce una lista vuota', async () => {
    await Character.deleteMany({});
    const res = await request(app).get('/api/characters');
    expect(res.body.characters).toEqual([]);
  });

  // ---- S0-8 ----------------------------------------------------------------
  describe('S0-8 — revoca della sessione al logout', () => {
    it('il token smette di funzionare dopo il logout', async () => {
      const reg = await request(app).post('/api/auth/register').send({
        email: 'revoca@example.com',
        username: 'revocauser',
        password: 'PasswordSicura1',
        birthdate: '1995-04-12'
      });
      expect(reg.status).toBe(201);
      const token = reg.body.token;
      const cookie = reg.headers['set-cookie'][0].split(';')[0];

      const before = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(before.status).toBe(200);

      const out = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
      expect(out.status).toBe(200);

      const afterHeader = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(afterHeader.status).toBe(401);

      const afterCookie = await request(app).get('/api/auth/me').set('Cookie', cookie);
      expect(afterCookie.status).toBe(401);
    });

    it('il logout senza sessione valida non è un errore del server', async () => {
      const res = await request(app).post('/api/auth/logout');
      expect(res.status).toBeLessThan(500);
    });
  });
});
