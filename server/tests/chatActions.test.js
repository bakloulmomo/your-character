/**
 * FASE C — Azioni sulla conversazione: streaming, rigenerazione, eliminazione.
 * Coprono S3-13 e S3-14, e verificano che la contabilità dei crediti resti
 * identica a quella della rotta non-streaming.
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
let chat;
const CLERK = 'clerk_actions';

/** Estrae gli eventi SSE dal corpo della risposta. */
const parseEvents = (raw) =>
  raw
    .split('\n\n')
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice(6)));

describe('FASE C — Streaming e azioni sui messaggi', () => {
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
    user = await User.create({ clerkId: CLERK, email: 'act@example.com', username: 'actions', credits: 50 });
    character = await Character.create({
      name: 'Narratore',
      description: 'Personaggio usato per verificare le azioni sulla conversazione.',
      personality: 'Racconta in modo prevedibile per rendere verificabili streaming e rigenerazione.',
      avatar: 'https://example.com/narratore.jpg',
      isPublic: true,
      createdBy: user._id
    });
    chat = await Chat.create({ userId: user._id, characterId: character._id });
  });

  describe('S3-13 — streaming della risposta', () => {
    it('la risposta arriva a pezzi e si chiude con il messaggio completo', async () => {
      const res = await request(app)
        .post('/api/messages/stream')
        .set('x-mock-clerk-id', CLERK)
        .send({ chatId: chat._id.toString(), content: 'Raccontami una storia breve' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');

      const events = parseEvents(res.text);
      const deltas = events.filter((e) => e.delta);
      const done = events.find((e) => e.done);

      expect(deltas.length).toBeGreaterThan(1);          // davvero a pezzi
      expect(done).toBeDefined();
      expect(done.aiMessage.content).toBe(deltas.map((d) => d.delta).join(''));
    });

    it('lo streaming addebita esattamente un credito', async () => {
      await request(app)
        .post('/api/messages/stream')
        .set('x-mock-clerk-id', CLERK)
        .send({ chatId: chat._id.toString(), content: 'Un solo messaggio' });

      expect((await User.findById(user._id)).credits).toBe(49);
    });

    it('senza crediti lo streaming non parte nemmeno', async () => {
      await User.findByIdAndUpdate(user._id, { credits: 0 });
      const res = await request(app)
        .post('/api/messages/stream')
        .set('x-mock-clerk-id', CLERK)
        .send({ chatId: chat._id.toString(), content: 'Non dovrei passare' });

      expect(res.status).toBe(402);
      expect(await Message.countDocuments({ chatId: chat._id })).toBe(0);
    });

    it('un guasto durante lo streaming rimborsa il credito', async () => {
      process.env.AI_MODE = 'fail';
      await request(app)
        .post('/api/messages/stream')
        .set('x-mock-clerk-id', CLERK)
        .send({ chatId: chat._id.toString(), content: 'Questo fallirà' });
      delete process.env.AI_MODE;

      expect((await User.findById(user._id)).credits).toBe(50);
      expect(await Message.countDocuments({ chatId: chat._id, role: 'assistant' })).toBe(0);
    });
  });

  describe('S3-14 — rigenerazione della risposta', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/messages')
        .set('x-mock-clerk-id', CLERK)
        .send({ chatId: chat._id.toString(), content: 'Ciao, come stai?' });
    });

    it('sostituisce l ultima risposta con una nuova', async () => {
      const before = await Message.findOne({ chatId: chat._id, role: 'assistant' });

      const res = await request(app)
        .post('/api/messages/regenerate')
        .set('x-mock-clerk-id', CLERK)
        .send({ chatId: chat._id.toString() });

      expect(res.status).toBe(200);
      expect(res.body.replacedMessageId).toBe(before._id.toString());

      // La vecchia risposta non deve restare in cronologia.
      expect(await Message.findById(before._id)).toBeNull();
      expect(await Message.countDocuments({ chatId: chat._id, role: 'assistant' })).toBe(1);
    });

    it('senza una risposta precedente non c è nulla da rigenerare', async () => {
      const empty = await Chat.create({ userId: user._id, characterId: character._id });
      const res = await request(app)
        .post('/api/messages/regenerate')
        .set('x-mock-clerk-id', CLERK)
        .send({ chatId: empty._id.toString() });

      expect(res.status).toBe(400);
    });

    it('un guasto ripristina la risposta precedente e rimborsa', async () => {
      const before = await Message.findOne({ chatId: chat._id, role: 'assistant' });
      const creditsBefore = (await User.findById(user._id)).credits;

      process.env.AI_MODE = 'fail';
      const res = await request(app)
        .post('/api/messages/regenerate')
        .set('x-mock-clerk-id', CLERK)
        .send({ chatId: chat._id.toString() });
      delete process.env.AI_MODE;

      expect(res.status).toBe(502);
      // La conversazione non resta monca.
      const restored = await Message.findOne({ chatId: chat._id, role: 'assistant' });
      expect(restored.content).toBe(before.content);
      expect((await User.findById(user._id)).credits).toBe(creditsBefore);
    });

    it('non si può rigenerare la conversazione di un altro utente', async () => {
      const res = await request(app)
        .post('/api/messages/regenerate')
        .set('x-mock-clerk-id', 'clerk_estraneo')
        .send({ chatId: chat._id.toString() });

      expect(res.status).toBe(404);
    });
  });

  describe('eliminazione di un singolo messaggio', () => {
    it('il proprietario può eliminare un messaggio della propria chat', async () => {
      const message = await Message.create({ chatId: chat._id, role: 'user', content: 'da eliminare' });
      const res = await request(app)
        .delete(`/api/messages/item/${message._id}`)
        .set('x-mock-clerk-id', CLERK);

      expect(res.status).toBe(200);
      expect(await Message.findById(message._id)).toBeNull();
    });

    it('un estraneo non può eliminare i messaggi di un altro', async () => {
      const message = await Message.create({ chatId: chat._id, role: 'user', content: 'protetto' });
      const res = await request(app)
        .delete(`/api/messages/item/${message._id}`)
        .set('x-mock-clerk-id', 'clerk_estraneo');

      expect(res.status).toBe(404);
      expect(await Message.findById(message._id)).not.toBeNull();
    });
  });
});
