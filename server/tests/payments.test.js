const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const stripeLib = require('stripe');
const app = require('../server');
const User = require('../models/User');
const Character = require('../models/Character');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Transaction = require('../models/Transaction');

const WEBHOOK_SECRET = 'whsec_test_segreto_per_la_suite_pagamenti';

/**
 * Firma un evento come farebbe Stripe. La firma non è più opzionale:
 * un webhook non firmato viene rifiutato con 400 (vedi S0-3 nel piano QA).
 */
const signedWebhook = (eventObject) => {
  const payload = JSON.stringify(eventObject);
  return {
    payload,
    header: stripeLib.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })
  };
};

let mongoServer;
let testUser;
let testCharacter;
let testChat;

describe('FASE 5: Image Generation & Stripe Payments Integration Tests', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Character.deleteMany({}),
      Chat.deleteMany({}),
      Message.deleteMany({}),
      Transaction.deleteMany({})
    ]);

    testUser = await User.create({
    emailVerifiedAt: new Date(),
      clerkId: 'clerk_payment_user',
      email: 'payment@example.com',
      username: 'paymentuser',
      credits: 30
    });

    testCharacter = await Character.create({
      name: 'Test AI',
      description: 'Personaggio per test di pagamenti.',
      personality: 'Amichevole e disponibile per test di sistema e verifica crediti.',
      avatar: 'https://example.com/test.jpg',
      isPublic: true,
      createdBy: testUser._id
    });

    const chatRes = await request(app)
      .post('/api/chats')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ characterId: testCharacter._id.toString() });

    testChat = chatRes.body;
  });

  // ── Image Generation Tests ─────────────────────────────────────────────────

  it('should return available credit packages GET /api/payments/packages', async () => {
    const res = await request(app).get('/api/payments/packages');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('starter');
    expect(res.body).toHaveProperty('popular');
    expect(res.body).toHaveProperty('premium');
    expect(res.body.starter.amount).toBe(299);   // €2.99
    expect(res.body.popular.amount).toBe(499);   // €4.99
    expect(res.body.premium.amount).toBe(1499);  // €14.99
  });

  it('should generate image and deduct 10 credits POST /api/images/generate', async () => {
    const res = await request(app)
      .post('/api/images/generate')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({
        chatId: testChat._id,
        prompt: 'A beautiful futuristic cyberpunk city at night with neon lights'
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(res.body.message.image).toHaveProperty('url');
    expect(res.body.message.image).toHaveProperty('prompt');
    expect(res.body.user.credits).toBe(20); // 30 - 10 = 20

    const updatedUser = await User.findById(testUser._id);
    expect(updatedUser.credits).toBe(20);
  });

  it('should reject image generation when user has fewer than 10 credits (HTTP 402)', async () => {
    await User.findByIdAndUpdate(testUser._id, { credits: 5 });

    const res = await request(app)
      .post('/api/images/generate')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({
        chatId: testChat._id,
        prompt: 'Cyberpunk landscape'
      });

    expect(res.status).toBe(402);
    expect(res.body.error).toContain('Crediti insufficienti');
  });

  // ── Stripe Payments Tests ──────────────────────────────────────────────────

  it('should create mock Stripe checkout session for starter pack (HTTP 200)', async () => {
    const res = await request(app)
      .post('/api/payments/checkout')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ packageId: 'starter' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('clientSecret');
    expect(res.body).toHaveProperty('transactionId');
    expect(res.body.package.credits).toBe(50);
    expect(res.body.mode).toBe('mock');
  });

  it('should grant credits server-side when confirming a mock checkout, idempotently (A1)', async () => {
    const checkout = await request(app)
      .post('/api/payments/checkout')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ packageId: 'starter' });

    expect(checkout.body.mode).toBe('mock');
    const txId = checkout.body.transactionId;

    const before = await User.findById(testUser._id);

    const confirm = await request(app)
      .post('/api/payments/confirm')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ transactionId: txId });

    expect(confirm.status).toBe(200);
    expect(confirm.body.credits).toBe(before.credits + 50); // starter = 50 credits

    // Second confirm must NOT double-grant
    const confirm2 = await request(app)
      .post('/api/payments/confirm')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ transactionId: txId });

    expect(confirm2.status).toBe(200);
    expect(confirm2.body.alreadyCompleted).toBe(true);

    const after = await User.findById(testUser._id);
    expect(after.credits).toBe(before.credits + 50);
  });

  it('S1-6 — riacquistare lo stesso pacchetto lo stesso giorno è possibile', async () => {
    const first = await request(app)
      .post('/api/payments/checkout')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ packageId: 'starter' });
    expect(first.status).toBe(200);

    await request(app)
      .post('/api/payments/confirm')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ transactionId: first.body.transactionId });

    // Prima la chiave di idempotenza conteneva solo la data: il secondo
    // acquisto violava l'indice unique e restituiva 500.
    const second = await request(app)
      .post('/api/payments/checkout')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ packageId: 'starter' });
    expect(second.status).toBe(200);

    const confirmSecond = await request(app)
      .post('/api/payments/confirm')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ transactionId: second.body.transactionId });
    expect(confirmSecond.status).toBe(200);

    const after = await User.findById(testUser._id);
    expect(after.credits).toBe(30 + 50 + 50); // entrambi gli acquisti accreditati
  });

  it('should return 400 for invalid package ID', async () => {
    const res = await request(app)
      .post('/api/payments/checkout')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ packageId: 'invalid_pack' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('non valido');
  });

  it('should activate a monthly subscription (mock) and then cancel it', async () => {
    const sub = await request(app)
      .post('/api/payments/subscribe')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ plan: 'monthly' });

    expect(sub.status).toBe(200);
    expect(sub.body.subscription).toBe('monthly');
    expect(new Date(sub.body.subscriptionExpiresAt).getTime()).toBeGreaterThan(Date.now());

    const activated = await User.findById(testUser._id);
    expect(activated.subscription).toBe('monthly');

    const cancel = await request(app)
      .post('/api/payments/cancel-subscription')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({});

    // La disdetta è a fine periodo: l'utente ha già pagato il mese in corso e
    // non deve perderlo. Prima il piano tornava subito a 'free' (S1-8).
    expect(cancel.status).toBe(200);
    expect(cancel.body.cancelAtPeriodEnd).toBe(true);
    expect(cancel.body.subscription).toBe('monthly');

    const cancelled = await User.findById(testUser._id);
    expect(cancelled.subscriptionCancelAtPeriodEnd).toBe(true);
    expect(cancelled.subscription).toBe('monthly');
    expect(cancelled.subscriptionExpiresAt).not.toBeNull();
  });

  it('un abbonamento disdetto torna gratuito solo alla scadenza del periodo pagato', async () => {
    await request(app)
      .post('/api/payments/subscribe')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ plan: 'monthly' });

    await request(app)
      .post('/api/payments/cancel-subscription')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({});

    // Finché il periodo pagato non è scaduto, l'accesso resta.
    const { applySubscriptionExpiry } = require('../utils/time');
    let user = await User.findById(testUser._id);
    await applySubscriptionExpiry(user);
    expect((await User.findById(testUser._id)).subscription).toBe('monthly');

    // Superata la scadenza, il piano torna gratuito.
    await User.findByIdAndUpdate(testUser._id, { subscriptionExpiresAt: new Date(Date.now() - 1000) });
    user = await User.findById(testUser._id);
    await applySubscriptionExpiry(user);
    expect((await User.findById(testUser._id)).subscription).toBe('free');
  });

  it('should reject an invalid subscription plan', async () => {
    const res = await request(app)
      .post('/api/payments/subscribe')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({ plan: 'lifetime' });

    expect(res.status).toBe(400);
  });

  it('should simulate Stripe webhook and grant credits to user', async () => {
    // Create a pending transaction first
    const tx = await Transaction.create({
      userId: testUser._id,
      type: 'purchase',
      credits: 50,
      grossCents: 299, netCents: 245, vatCents: 54, vatRate: 22, country: 'IT',
      stripePaymentIntentId: 'pi_mock_webhook_test_123',
      status: 'pending',
      idempotencyKey: 'test_idempotency_key_webhook'
    });

    const mockEvent = {
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_mock_webhook_test_123',
          metadata: {
            userId: testUser._id.toString(),
            credits: '50',
            packageId: 'starter'
          }
        }
      }
    };

    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const { payload, header } = signedWebhook(mockEvent);
    const res = await request(app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', header)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const updatedUser = await User.findById(testUser._id);
    expect(updatedUser.credits).toBe(80); // 30 + 50 = 80

    const updatedTx = await Transaction.findById(tx._id);
    expect(updatedTx.status).toBe('completed');
  });

  it('should handle duplicate webhook gracefully (idempotency check)', async () => {
    // Mark transaction as already completed
    await Transaction.create({
      userId: testUser._id,
      type: 'purchase',
      credits: 50,
      grossCents: 299, netCents: 245, vatCents: 54, vatRate: 22, country: 'IT',
      stripePaymentIntentId: 'pi_mock_dup_123',
      status: 'completed',
      idempotencyKey: 'test_dup_key'
    });

    const mockEvent = {
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_mock_dup_123',
          metadata: {
            userId: testUser._id.toString(),
            credits: '50'
          }
        }
      }
    };

    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const { payload, header } = signedWebhook(mockEvent);
    const res = await request(app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', header)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);

    // Credits must NOT be doubled
    const updatedUser = await User.findById(testUser._id);
    expect(updatedUser.credits).toBe(30); // Unchanged
  });
});
