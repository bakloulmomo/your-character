/**
 * Ritenzione fiscale delle transazioni.
 *
 * L'informativa privacy pubblicata dichiara: «le transazioni sono conservate
 * per l'obbligo fiscale decennale». Il codice eseguiva `Transaction.deleteMany`
 * alla cancellazione dell'account: faceva esattamente l'opposto del documento,
 * distruggeva registri che l'art. 2220 c.c. obbliga a tenere dieci anni, e
 * bucava la numerazione progressiva delle ricevute gia' emesse.
 *
 * Questi test verificano le due meta' della correzione: che la riga contabile
 * sopravviva, e che i dati PERSONALI non necessari spariscano davvero.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Character = require('../models/Character');
const Transaction = require('../models/Transaction');

let mongoServer;
let utente;
let token;

const tokenFor = (u) =>
  jwt.sign({ id: u._id, email: u.email, username: u.username, tv: u.tokenVersion || 0 },
    process.env.JWT_SECRET, { expiresIn: '1h' });

describe('Ritenzione fiscale alla cancellazione dell account', () => {
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
      User.deleteMany({}), Chat.deleteMany({}), Message.deleteMany({}),
      Character.deleteMany({}), Transaction.deleteMany({})
    ]);

    utente = await User.create({
    emailVerifiedAt: new Date(),
      email: 'cliente@example.com', username: 'cliente', authProvider: 'local',
      birthdate: new Date('1990-01-01'), credits: 50
    });
    token = tokenFor(utente);

    await Transaction.create({
      userId: utente._id, type: 'purchase', credits: 150,
      grossCents: 499, netCents: 409, vatCents: 90, vatRate: 22, country: 'IT',
      currency: 'eur', status: 'completed', completedAt: new Date(),
      invoiceNumber: 'YC-2026-000042',
      customerSnapshot: { username: 'cliente', email: 'cliente@example.com', country: 'IT' }
    });
  });

  it('la transazione SOPRAVVIVE alla cancellazione dell account', async () => {
    const res = await request(app).delete('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const rimaste = await Transaction.find({});
    expect(rimaste).toHaveLength(1);
    expect(rimaste[0].invoiceNumber).toBe('YC-2026-000042');
  });

  it('e viene marcata come appartenente a un account cancellato', async () => {
    await request(app).delete('/api/users/me').set('Authorization', `Bearer ${token}`);
    const tx = await Transaction.findOne({});
    expect(tx.accountDeletedAt).toBeInstanceOf(Date);
  });

  it('l istantanea del cliente resta, cosi la ricevuta e ancora emettibile', async () => {
    await request(app).delete('/api/users/me').set('Authorization', `Bearer ${token}`);
    const tx = await Transaction.findOne({});
    expect(tx.customerSnapshot.email).toBe('cliente@example.com');
    expect(tx.customerSnapshot.country).toBe('IT');
  });

  it('ma tutto il resto dei dati personali sparisce davvero', async () => {
    const personaggio = await Character.create({
      name: 'Privato', description: 'Una descrizione sufficientemente lunga.',
      personality: 'Una personalita con almeno venti caratteri dentro.',
      avatar: 'https://example.com/p.jpg', createdBy: utente._id,
      isPublic: false, systemPrompt: 'x'
    });
    const chat = await Chat.create({ userId: utente._id, characterId: personaggio._id, title: 'c' });
    await Message.create({ chatId: chat._id, role: 'user', content: 'confidenziale' });

    await request(app).delete('/api/users/me').set('Authorization', `Bearer ${token}`);

    expect(await User.findById(utente._id)).toBeNull();
    expect(await Chat.countDocuments({ userId: utente._id })).toBe(0);
    expect(await Message.countDocuments({ chatId: chat._id })).toBe(0);
    expect(await Character.countDocuments({ _id: personaggio._id })).toBe(0);
  });

  it('la numerazione progressiva non presenta buchi dopo una cancellazione', async () => {
    await Transaction.create({
      userId: utente._id, type: 'purchase', credits: 50, grossCents: 299,
      currency: 'eur', status: 'completed', invoiceNumber: 'YC-2026-000043'
    });

    await request(app).delete('/api/users/me').set('Authorization', `Bearer ${token}`);

    const numeri = (await Transaction.find({}).sort({ invoiceNumber: 1 })).map((t) => t.invoiceNumber);
    expect(numeri).toEqual(['YC-2026-000042', 'YC-2026-000043']);
  });
});
