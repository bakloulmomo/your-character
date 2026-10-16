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
    user = await User.create({
    emailVerifiedAt: new Date(), clerkId: CLERK, email: 'act@example.com', username: 'actions', credits: 50 });
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

  /**
   * Un turno già arrivato allo schermo non si cancella.
   *
   * Gemini valuta la sicurezza MENTRE genera, quindi il taglio arriva quasi
   * sempre a metà di un testo che fino a quel momento era passato. Il codice
   * trattava quel taglio come un guasto: buttava via tutto e rispondeva con un
   * errore, e l'utente vedeva la risposta comparire e poi sparire. Con un
   * personaggio scritto per essere pungente — «tua cugina, un po' gelosa, che
   * ti dà della viziata» — succedeva a ogni singolo messaggio.
   */
  describe('risposta troncata dai filtri del modello', () => {
    const { generateResponseStream } = require('../services/geminiService');

    it('la parte già generata viene consegnata invece di essere buttata', async () => {
      // Il modello emette due frammenti buoni, poi si ferma per sicurezza.
      const gemini = require('@google/generative-ai');
      const originale = gemini.GoogleGenerativeAI.prototype.getGenerativeModel;
      gemini.GoogleGenerativeAI.prototype.getGenerativeModel = () => ({
        generateContentStream: async () => ({
          stream: (async function* () {
            yield { text: () => 'Prima parte, ', candidates: [{ finishReason: null }] };
            yield { text: () => 'seconda parte.', candidates: [{ finishReason: null }] };
            yield { text: () => '', candidates: [{ finishReason: 'SAFETY' }] };
          })()
        })
      });

      const precedente = process.env.AI_MODE;
      process.env.AI_MODE = 'live';
      process.env.GEMINI_API_KEY = 'chiave-non-segnaposto-per-il-test-0123456789';

      try {
        const pezzi = [];
        const r = await generateResponseStream(
          [{ role: 'system', content: 'istruzioni' }, { role: 'user', content: 'ciao' }],
          'Prova',
          (d) => pezzi.push(d)
        );

        expect(r.content).toBe('Prima parte, seconda parte.');
        expect(pezzi.join('')).toBe('Prima parte, seconda parte.');
        // Il taglio resta registrato: serve a chi modera, non all'utente.
        expect(r.truncatedBySafety).toBe('SAFETY');
      } finally {
        gemini.GoogleGenerativeAI.prototype.getGenerativeModel = originale;
        if (precedente === undefined) delete process.env.AI_MODE; else process.env.AI_MODE = precedente;
      }
    });

    it('ma se non era arrivato NIENTE, resta un errore', async () => {
      const gemini = require('@google/generative-ai');
      const originale = gemini.GoogleGenerativeAI.prototype.getGenerativeModel;
      gemini.GoogleGenerativeAI.prototype.getGenerativeModel = () => ({
        generateContentStream: async () => ({
          stream: (async function* () {
            yield { text: () => '', candidates: [{ finishReason: 'SAFETY' }] };
          })()
        })
      });

      const precedente = process.env.AI_MODE;
      process.env.AI_MODE = 'live';
      process.env.GEMINI_API_KEY = 'chiave-non-segnaposto-per-il-test-0123456789';

      try {
        await expect(
          generateResponseStream([{ role: 'user', content: 'ciao' }], 'Prova', () => {})
        ).rejects.toMatchObject({ safetyBlocked: true });
      } finally {
        gemini.GoogleGenerativeAI.prototype.getGenerativeModel = originale;
        if (precedente === undefined) delete process.env.AI_MODE; else process.env.AI_MODE = precedente;
      }
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

    /**
     * Eliminare deve togliere il messaggio dalla CONVERSAZIONE, non solo dalla
     * vista: il riassunto viene reinserito nel contesto a ogni turno, quindi
     * finché ci resta dentro il personaggio continua a ricordare ciò che
     * l'utente ha cancellato.
     */
    it('la memoria lunga smette di contenere il messaggio eliminato', async () => {
      await Chat.findByIdAndUpdate(chat._id, {
        conversationSummary: 'L utente ha raccontato un fatto personale che ora ha cancellato.'
      });
      const message = await Message.create({ chatId: chat._id, role: 'user', content: 'un fatto personale' });

      await request(app)
        .delete(`/api/messages/item/${message._id}`)
        .set('x-mock-clerk-id', CLERK)
        .expect(200);

      const dopo = await Chat.findById(chat._id);
      expect(dopo.conversationSummary).toBe('');
    });

    it('i contatori della conversazione si riallineano ai messaggi rimasti', async () => {
      const primo = await Message.create({ chatId: chat._id, role: 'user', content: 'primo' });
      await Message.create({ chatId: chat._id, role: 'assistant', content: 'secondo' });
      // Un contatore già disallineato: prima `$inc: -1` lo portava sotto zero.
      await Chat.findByIdAndUpdate(chat._id, { messageCount: 0, lastMessageAt: new Date('2020-01-01') });

      const res = await request(app)
        .delete(`/api/messages/item/${primo._id}`)
        .set('x-mock-clerk-id', CLERK)
        .expect(200);

      const dopo = await Chat.findById(chat._id);
      expect(dopo.messageCount).toBe(1);
      expect(dopo.lastMessageAt.getFullYear()).toBeGreaterThan(2020);
      // La risposta riporta lo stato aggiornato, così il client non deve
      // indovinarlo né ricaricare tutto.
      expect(res.body.chat.messageCount).toBe(1);
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
