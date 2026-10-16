/**
 * FASE B — Integrità referenziale, paginazione e validazione.
 * Codifica S1-10, S1-12, S1-13, S1-14 e S2-11 del piano QA.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');
const Character = require('../models/Character');
const Chat = require('../models/Chat');
const Message = require('../models/Message');

let mongoServer;
let user;
let character;

const CLERK = 'clerk_integrity';

describe('FASE B — Integrità dei dati', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Character.deleteMany({}), Chat.deleteMany({}), Message.deleteMany({})]);
    user = await User.create({
    emailVerifiedAt: new Date(), clerkId: CLERK, email: 'integ@example.com', username: 'integrity', credits: 200 });
    character = await Character.create({
      name: 'Personaggio Test',
      description: 'Personaggio usato per i test di integrità referenziale.',
      personality: 'Serve a verificare che le cancellazioni non lascino dati orfani nel database.',
      avatar: 'https://example.com/test.jpg',
      isPublic: true,
      createdBy: user._id
    });
  });

  // ---- S1-10 ---------------------------------------------------------------
  describe('S1-10 — eliminare un personaggio non lascia chat orfane', () => {
    it('le chat collegate spariscono insieme al personaggio', async () => {
      const created = await request(app).post('/api/chats').set('x-mock-clerk-id', CLERK)
        .send({ characterId: character._id.toString() });
      const chatId = created.body._id;

      const del = await request(app).delete(`/api/characters/${character._id}`).set('x-mock-clerk-id', CLERK);
      expect(del.status).toBe(200);

      expect(await Chat.countDocuments({ _id: chatId })).toBe(0);
      expect(await Message.countDocuments({ chatId })).toBe(0);
    });

    it('la lista chat non restituisce mai un personaggio nullo', async () => {
      await request(app).post('/api/chats').set('x-mock-clerk-id', CLERK)
        .send({ characterId: character._id.toString() });
      await request(app).delete(`/api/characters/${character._id}`).set('x-mock-clerk-id', CLERK);

      const list = await request(app).get('/api/chats').set('x-mock-clerk-id', CLERK);
      expect(list.status).toBe(200);
      list.body.forEach((c) => expect(c.characterId).not.toBeNull());
    });
  });

  // ---- S1-12 ---------------------------------------------------------------
  describe('S1-12 — lo storico restituisce gli ULTIMI messaggi', () => {
    let chat;

    beforeEach(async () => {
      chat = await Chat.create({ userId: user._id, characterId: character._id });
      const docs = Array.from({ length: 120 }, (_, i) => ({
        chatId: chat._id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `m${i}`,
        createdAt: new Date(Date.now() + i * 1000)
      }));
      await Message.insertMany(docs);
    });

    it('la prima pagina contiene il messaggio più recente', async () => {
      const res = await request(app).get(`/api/messages/${chat._id}`).set('x-mock-clerk-id', CLERK);
      expect(res.status).toBe(200);

      const contents = res.body.messages.map((m) => m.content);
      expect(contents[contents.length - 1]).toBe('m119');
    });

    it('i messaggi arrivano in ordine cronologico crescente', async () => {
      const res = await request(app).get(`/api/messages/${chat._id}`).set('x-mock-clerk-id', CLERK);
      const dates = res.body.messages.map((m) => new Date(m.createdAt).getTime());
      expect(dates).toEqual([...dates].sort((a, b) => a - b));
    });

    it('il cursore permette di risalire indietro nello storico', async () => {
      const first = await request(app).get(`/api/messages/${chat._id}?limit=50`).set('x-mock-clerk-id', CLERK);
      expect(first.body.messages).toHaveLength(50);
      expect(first.body.hasMore).toBe(true);

      const older = await request(app)
        .get(`/api/messages/${chat._id}?limit=50&before=${first.body.nextCursor}`)
        .set('x-mock-clerk-id', CLERK);

      expect(older.body.messages).toHaveLength(50);
      const firstIds = first.body.messages.map((m) => m._id);
      older.body.messages.forEach((m) => expect(firstIds).not.toContain(m._id));
    });

    it('esaurito lo storico, hasMore diventa falso', async () => {
      let cursor = null;
      let guard = 0;
      let last;
      do {
        const url = `/api/messages/${chat._id}?limit=50${cursor ? `&before=${cursor}` : ''}`;
        last = await request(app).get(url).set('x-mock-clerk-id', CLERK);
        cursor = last.body.nextCursor;
        guard++;
      } while (last.body.hasMore && guard < 10);

      expect(last.body.hasMore).toBe(false);
      expect(guard).toBeLessThan(10);
    });
  });

  // ---- S1-13 ---------------------------------------------------------------
  describe('S1-13 — registrazioni simultanee non danno 500', () => {
    const payload = {
      email: 'gara@example.com',
      username: 'garauser',
      password: 'PasswordSicura1',
      birthdate: '1992-03-15'
    };

    it('due registrazioni identiche in parallelo danno 201 e 400', async () => {
      const [a, b] = await Promise.all([
        request(app).post('/api/auth/register').send(payload),
        request(app).post('/api/auth/register').send(payload)
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 400]);
      expect(await User.countDocuments({ email: payload.email })).toBe(1);
    });

    it('un username già preso restituisce un errore leggibile', async () => {
      await request(app).post('/api/auth/register').send(payload);
      const res = await request(app).post('/api/auth/register').send({
        ...payload,
        email: 'altra@example.com'
      });
      expect(res.status).toBe(400);
      expect(res.body.error.toLowerCase()).toContain('username');
    });
  });

  // ---- S1-14 ---------------------------------------------------------------
  describe('S1-14 — l avatar deve essere un URL utilizzabile', () => {
    const base = {
      name: 'Avatar Test',
      description: 'Personaggio per verificare la validazione dell avatar.',
      personality: 'Serve solo a controllare che un URL non valido venga rifiutato dal server.'
    };

    it('uno schema javascript: viene rifiutato', async () => {
      const res = await request(app).post('/api/characters').set('x-mock-clerk-id', CLERK)
        .send({ ...base, avatar: 'javascript:alert(1)' });
      expect(res.status).toBe(400);
    });

    it('una stringa qualunque viene rifiutata', async () => {
      const res = await request(app).post('/api/characters').set('x-mock-clerk-id', CLERK)
        .send({ ...base, avatar: 'non-e-un-url' });
      expect(res.status).toBe(400);
    });

    it('un URL http/https viene accettato', async () => {
      const res = await request(app).post('/api/characters').set('x-mock-clerk-id', CLERK)
        .send({ ...base, avatar: 'https://example.com/volto.jpg' });
      expect(res.status).toBe(201);
    });
  });

  // ---- S2-11 ---------------------------------------------------------------
  describe('S2-11 — la cancellazione account non lascia personaggi orfani', () => {
    it('i personaggi pubblici del creatore non restano senza autore', async () => {
      await request(app).delete('/api/users/me').set('x-mock-clerk-id', CLERK);

      const survivor = await Character.findById(character._id);
      if (survivor) {
        // Se il personaggio pubblico sopravvive, deve avere un autore esistente.
        const author = await User.findById(survivor.createdBy);
        expect(author).not.toBeNull();
      }
      expect(await User.countDocuments({ clerkId: CLERK })).toBe(0);
    });
  });
});
