/**
 * FASE B — Limiti di frequenza (S1-3, S1-4).
 *
 * I limitatori sono spenti nella suite normale, altrimenti falserebbero i test
 * di concorrenza. Qui vengono accesi apposta con FORCE_RATE_LIMIT=1 per
 * verificare che esistano davvero e che colpiscano il traffico giusto.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.FORCE_RATE_LIMIT = '1';
const app = require('../server');
const User = require('../models/User');
const Character = require('../models/Character');
const Chat = require('../models/Chat');
const Message = require('../models/Message');

let mongoServer;
let user;
let chat;

const CLERK = 'clerk_ratelimit';

describe('FASE B — Limiti di frequenza sugli endpoint costosi', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    delete process.env.FORCE_RATE_LIMIT;
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Character.deleteMany({}), Chat.deleteMany({}), Message.deleteMany({})]);
    user = await User.create({ clerkId: CLERK, email: 'rl@example.com', username: 'ratelimited', credits: 10000 });
    const character = await Character.create({
      name: 'Bersaglio',
      description: 'Personaggio usato per verificare i limiti di frequenza.',
      personality: 'Serve a controllare che il server rifiuti il traffico eccessivo verso il modello.',
      avatar: 'https://example.com/target.jpg',
      isPublic: true,
      createdBy: user._id
    });
    chat = await Chat.create({ userId: user._id, characterId: character._id });
  });

  it('S1-3 — un diluvio di messaggi viene fermato con 429', async () => {
    const results = [];
    for (let i = 0; i < 30; i++) {
      results.push(
        await request(app)
          .post('/api/messages')
          .set('x-mock-clerk-id', CLERK)
          .send({ chatId: chat._id.toString(), content: `flood ${i}` })
      );
    }

    const limited = results.filter((r) => r.status === 429).length;
    const served = results.filter((r) => r.status === 200).length;

    expect(limited).toBeGreaterThan(0);   // il limite esiste
    expect(served).toBeLessThan(30);      // e non tutto passa
  });

  it('S1-3 — le richieste di immagini hanno un limite più stretto dei messaggi', async () => {
    const results = [];
    for (let i = 0; i < 12; i++) {
      results.push(
        await request(app)
          .post('/api/images/generate')
          .set('x-mock-clerk-id', CLERK)
          .send({ chatId: chat._id.toString(), prompt: `immagine numero ${i} di prova` })
      );
    }
    expect(results.filter((r) => r.status === 429).length).toBeGreaterThan(0);
  });

  it('S1-3 — le segnalazioni ripetute vengono limitate', async () => {
    const character = await Character.findOne({ createdBy: user._id });
    const results = [];
    for (let i = 0; i < 30; i++) {
      results.push(
        await request(app)
          .post('/api/reports')
          .set('x-mock-clerk-id', CLERK)
          .send({ targetType: 'character', targetId: character._id.toString(), reason: 'spam' })
      );
    }
    expect(results.filter((r) => r.status === 429).length).toBeGreaterThan(0);
  });

  it('S1-4 — il limite è per utente, non globale: un altro utente non viene bloccato', async () => {
    for (let i = 0; i < 25; i++) {
      await request(app)
        .post('/api/messages')
        .set('x-mock-clerk-id', CLERK)
        .send({ chatId: chat._id.toString(), content: `saturazione ${i}` });
    }

    // Un secondo utente, con la propria chat, deve poter scrivere lo stesso:
    // con una chiave basata solo sull'IP sarebbe stato bloccato anche lui.
    const other = await User.create({ clerkId: 'clerk_altro', email: 'altro@example.com', username: 'altro', credits: 100 });
    const otherCharacter = await Character.create({
      name: 'Secondo',
      description: 'Personaggio del secondo utente per il test di isolamento.',
      personality: 'Verifica che il limite di frequenza sia applicato per utente e non globalmente.',
      avatar: 'https://example.com/second.jpg',
      isPublic: true,
      createdBy: other._id
    });
    const otherChat = await Chat.create({ userId: other._id, characterId: otherCharacter._id });

    const res = await request(app)
      .post('/api/messages')
      .set('x-mock-clerk-id', 'clerk_altro')
      .send({ chatId: otherChat._id.toString(), content: 'sono un altro utente' });

    expect(res.status).toBe(200);
  });

  it('S1-4 — il server dichiara di fidarsi di un solo hop di proxy', () => {
    // Senza questo, dietro un reverse proxy tutti gli utenti condividerebbero
    // l'IP del proxy e cinque tentativi falliti bloccherebbero il login a tutti.
    expect(app.get('trust proxy')).toBe(1);
  });
});
