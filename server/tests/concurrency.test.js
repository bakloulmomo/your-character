/**
 * FASE B — Integrità economica sotto concorrenza (regressione permanente).
 *
 * Codifica S1-1, S1-2, S1-5 e S1-11: ogni risposta servita deve corrispondere
 * a un credito realmente addebitato, i limiti giornalieri non si superano, e
 * ogni messaggio scritto deve arrivare al modello.
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

const CLERK = 'clerk_concurrency';

const sendMessages = (count, chatId = chat._id.toString()) =>
  Promise.all(
    Array.from({ length: count }, (_, i) =>
      request(app)
        .post('/api/messages')
        .set('x-mock-clerk-id', CLERK)
        .send({ chatId, content: `messaggio numero ${i}` })
    )
  );

describe('FASE B — Integrità economica sotto concorrenza', () => {
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
    emailVerifiedAt: new Date(), clerkId: CLERK, email: 'conc@example.com', username: 'concurrent', credits: 5 });
    character = await Character.create({
      name: 'Sfidante',
      description: 'Personaggio usato per i test di concorrenza sui crediti.',
      personality: 'Risponde in modo prevedibile per rendere verificabile la contabilità dei crediti.',
      avatar: 'https://example.com/sfidante.jpg',
      isPublic: true,
      createdBy: user._id
    });
    chat = await Chat.create({ userId: user._id, characterId: character._id });
  });

  // ---- S1-2 ----------------------------------------------------------------
  it('S1-2 — le risposte servite non superano mai i crediti addebitati', async () => {
    const results = await sendMessages(20);
    const served = results.filter((r) => r.status === 200).length;
    const refused = results.filter((r) => r.status === 402).length;
    const after = await User.findById(user._id);

    expect(served).toBe(5);              // esattamente i crediti disponibili
    expect(refused).toBe(15);
    expect(after.credits).toBe(0);       // e nessun credito residuo
  });

  it('S1-2 — il saldo non diventa mai negativo', async () => {
    await sendMessages(30);
    const after = await User.findById(user._id);
    expect(after.credits).toBeGreaterThanOrEqual(0);
  });

  // ---- S1-1 ----------------------------------------------------------------
  it('S1-1 — un abbonato non supera il limite giornaliero sotto concorrenza', async () => {
    await User.findByIdAndUpdate(user._id, {
      subscription: 'monthly',
      subscriptionExpiresAt: new Date(Date.now() + 30 * 86400000),
      dailyMessageCount: 47,
      lastResetDate: new Date()
    });

    const results = await sendMessages(20);
    const served = results.filter((r) => r.status === 200).length;
    const after = await User.findById(user._id);

    expect(served).toBe(3);                    // 47 → 50, non oltre
    expect(after.dailyMessageCount).toBe(50);
  });

  it('S1-1 — il contatore giornaliero non supera il limite nemmeno per le immagini', async () => {
    await User.findByIdAndUpdate(user._id, {
      subscription: 'monthly',
      subscriptionExpiresAt: new Date(Date.now() + 30 * 86400000),
      dailyImageCount: 3,
      lastResetDate: new Date()
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app)
          .post('/api/images/generate')
          .set('x-mock-clerk-id', CLERK)
          .send({ chatId: chat._id.toString(), prompt: 'un paesaggio montano al tramonto' })
      )
    );

    const served = results.filter((r) => r.status === 200).length;
    const after = await User.findById(user._id);
    expect(served).toBe(2);                  // 3 → 5, non oltre
    expect(after.dailyImageCount).toBe(5);
  });

  // ---- rimborso -----------------------------------------------------------
  it('un fallimento del modello non lascia il credito addebitato', async () => {
    process.env.AI_MODE = 'fail';
    const res = await request(app)
      .post('/api/messages')
      .set('x-mock-clerk-id', CLERK)
      .send({ chatId: chat._id.toString(), content: 'questo messaggio non riceverà risposta' });
    delete process.env.AI_MODE;

    expect(res.status).toBe(502);
    const after = await User.findById(user._id);
    expect(after.credits).toBe(5); // credito riservato e poi restituito
  });

  it('un errore del modello non viene salvato come messaggio permanente', async () => {
    process.env.AI_MODE = 'fail';
    await request(app)
      .post('/api/messages')
      .set('x-mock-clerk-id', CLERK)
      .send({ chatId: chat._id.toString(), content: 'messaggio destinato a fallire' });
    delete process.env.AI_MODE;

    const assistantMessages = await Message.find({ chatId: chat._id, role: 'assistant' });
    expect(assistantMessages).toHaveLength(0);
  });

  // ---- S1-5 ----------------------------------------------------------------
  it('S1-5 — ogni messaggio inviato finisce nel contesto del modello', async () => {
    await User.findByIdAndUpdate(user._id, { credits: 100 });
    await sendMessages(8);

    const userMessages = await Message.countDocuments({ chatId: chat._id, role: 'user' });
    expect(userMessages).toBe(8);

    const { buildContext } = require('../services/contextManager');
    const freshChat = await Chat.findById(chat._id);
    const context = await buildContext(freshChat, character);
    const inContext = context.filter((m) => m.role === 'user').length;

    // Nessun aggiornamento perso: il contesto si ricostruisce dai messaggi
    // salvati, non da un secondo documento riscritto in parallelo.
    expect(inContext).toBe(userMessages);
  });

  it('S1-5 — il contesto di una chat non contiene i messaggi di un altra', async () => {
    await User.findByIdAndUpdate(user._id, { credits: 100 });
    const otherChat = await Chat.create({ userId: user._id, characterId: character._id });

    await request(app).post('/api/messages').set('x-mock-clerk-id', CLERK)
      .send({ chatId: chat._id.toString(), content: 'segreto della prima chat' });
    await request(app).post('/api/messages').set('x-mock-clerk-id', CLERK)
      .send({ chatId: otherChat._id.toString(), content: 'argomento della seconda chat' });

    const { buildContext } = require('../services/contextManager');
    const context = await buildContext(await Chat.findById(otherChat._id), character);
    const testo = JSON.stringify(context);

    expect(testo).toContain('argomento della seconda chat');
    expect(testo).not.toContain('segreto della prima chat');
  });

  // ---- S1-11 ---------------------------------------------------------------
  it('S1-11 — messageCount coincide con i messaggi realmente presenti', async () => {
    await User.findByIdAndUpdate(user._id, { credits: 100 });
    const created = await request(app)
      .post('/api/chats')
      .set('x-mock-clerk-id', CLERK)
      .send({ characterId: character._id.toString() });
    const chatId = created.body._id;

    await sendMessages(6, chatId);

    const updated = await Chat.findById(chatId);
    const real = await Message.countDocuments({ chatId });
    expect(updated.messageCount).toBe(real);
  });
});
