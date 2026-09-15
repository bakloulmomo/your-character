const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');
const Character = require('../models/Character');
const Chat = require('../models/Chat');
const Message = require('../models/Message');

let mongoServer;
let testUser;
let testCharacter;

describe('AI Chat Engine & Memory Context Integration Tests', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  }, 30000);

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Character.deleteMany({}),
      Chat.deleteMany({}),
      Message.deleteMany({}),
    ]);

    testUser = await User.create({
    emailVerifiedAt: new Date(),
      clerkId: 'clerk_chat_user_1',
      email: 'chatuser@example.com',
      username: 'chatuser',
      credits: 10
    });

    testCharacter = await Character.create({
      name: 'Aria Assistant',
      description: 'Una guida brillante per esplorare le proprie idee.',
      personality: 'Empatica, incoraggiante e brillante.',
      avatar: 'https://example.com/aria.jpg',
      category: 'assistant',
      isPublic: true,
      // Dalla FASE D un personaggio pubblico nasce in attesa di revisione
      // (S2-2): questa fixture rappresenta un personaggio già in galleria,
      // usato anche da utenti diversi dal creatore.
      moderationStatus: 'approved',
      createdBy: testUser._id
    });
  });

  it('should create a new chat session with character greeting', async () => {
    const res = await request(app)
      .post('/api/chats')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({
        characterId: testCharacter._id.toString()
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('title', 'Chat con Aria Assistant');

    // Verify initial message was created
    const messages = await Message.find({ chatId: res.body._id });
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe('assistant');
  });

  it('should send a message, receive AI response, and decrement user credits atomistically', async () => {
    const chatRes = await request(app)
      .post('/api/chats')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ characterId: testCharacter._id.toString() });

    const msgRes = await request(app)
      .post('/api/messages')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({
        chatId: chatRes.body._id,
        content: 'Ciao Aria! Quali sono le tue idee per organizzare la giornata?'
      });

    expect(msgRes.status).toBe(200);
    expect(msgRes.body).toHaveProperty('userMessage');
    expect(msgRes.body).toHaveProperty('aiMessage');
    expect(msgRes.body.user.credits).toBe(9); // 10 - 1 = 9

    const updatedUser = await User.findById(testUser._id);
    expect(updatedUser.credits).toBe(9);
  });

  it('should isolate conversation context between two distinct chats with the same character', async () => {
    const chat1 = await request(app)
      .post('/api/chats')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ characterId: testCharacter._id.toString(), title: 'Chat Uno' });

    const chat2 = await request(app)
      .post('/api/chats')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ characterId: testCharacter._id.toString(), title: 'Chat Due' });

    await request(app)
      .post('/api/messages')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ chatId: chat1.body._id, content: 'Messaggio per Chat Uno' });

    await request(app)
      .post('/api/messages')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ chatId: chat2.body._id, content: 'Messaggio per Chat Due' });

    // L'isolamento si verifica sul contesto realmente inviato al modello,
    // non sull'esistenza di due documenti separati: è la proprietà che conta.
    const { buildContext } = require('../services/contextManager');
    const context1 = await buildContext(await Chat.findById(chat1.body._id), testCharacter);
    const context2 = await buildContext(await Chat.findById(chat2.body._id), testCharacter);

    expect(JSON.stringify(context1)).toContain('Messaggio per Chat Uno');
    expect(JSON.stringify(context1)).not.toContain('Messaggio per Chat Due');
    expect(JSON.stringify(context2)).toContain('Messaggio per Chat Due');
    expect(JSON.stringify(context2)).not.toContain('Messaggio per Chat Uno');
  });

  it('should block unsafe content with moderation filter (HTTP 400)', async () => {
    const chatRes = await request(app)
      .post('/api/chats')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ characterId: testCharacter._id.toString() });

    const res = await request(app)
      .post('/api/messages')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({
        chatId: chatRes.body._id,
        content: 'suicide instructions request'
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    // Il messaggio non è più generico: la moderazione dice QUALE regola è
    // scattata, così l'utente sa che cosa non può chiedere (FASE D).
    expect(res.body.category).toBe('self_harm_instructions');
  });

  it('should reject message when user has 0 credits (HTTP 402)', async () => {
    await User.findByIdAndUpdate(testUser._id, { credits: 0 });

    const chatRes = await request(app)
      .post('/api/chats')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ characterId: testCharacter._id.toString() });

    const res = await request(app)
      .post('/api/messages')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({
        chatId: chatRes.body._id,
        content: 'Ciao'
      });

    expect(res.status).toBe(402);
    expect(res.body.error).toContain('Crediti esauriti');
  });

  it('should revert an expired subscription to free on activity (subscription expiry)', async () => {
    const expUser = await User.create({
    emailVerifiedAt: new Date(),
      clerkId: 'clerk_expired_sub',
      email: 'expired@example.com',
      username: 'expireduser',
      subscription: 'monthly',
      subscriptionExpiresAt: new Date('2020-01-01T00:00:00Z'), // lapsed
      credits: 5
    });

    const chatRes = await request(app)
      .post('/api/chats')
      .set('x-mock-clerk-id', expUser.clerkId)
      .send({ characterId: testCharacter._id.toString() });

    const res = await request(app)
      .post('/api/messages')
      .set('x-mock-clerk-id', expUser.clerkId)
      .send({ chatId: chatRes.body._id, content: 'Ciao' });

    expect(res.status).toBe(200);

    const updated = await User.findById(expUser._id);
    expect(updated.subscription).toBe('free'); // reverted
    expect(updated.credits).toBe(4); // charged as a free user
  });

  it('should roll over daily message counter for subscription users after a new day (A4)', async () => {
    const subUser = await User.create({
    emailVerifiedAt: new Date(),
      clerkId: 'clerk_sub_daily',
      email: 'subdaily@example.com',
      username: 'subdaily',
      subscription: 'monthly',
      dailyMessageCount: 50, // at the monthly limit
      lastResetDate: new Date('2020-01-01T00:00:00Z') // stale -> should reset
    });

    const chatRes = await request(app)
      .post('/api/chats')
      .set('x-mock-clerk-id', subUser.clerkId)
      .send({ characterId: testCharacter._id.toString() });

    const res = await request(app)
      .post('/api/messages')
      .set('x-mock-clerk-id', subUser.clerkId)
      .send({ chatId: chatRes.body._id, content: 'Ciao, nuovo giorno!' });

    expect(res.status).toBe(200); // not blocked by yesterday's limit

    const updated = await User.findById(subUser._id);
    expect(updated.dailyMessageCount).toBe(1); // reset to 0, then +1
    expect(new Date(updated.lastResetDate).getUTCFullYear()).toBeGreaterThan(2020);
  });
});
