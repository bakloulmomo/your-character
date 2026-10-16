/**
 * La cronologia delle conversazioni non deve crescere senza limite.
 *
 * `GET /api/chats` non aveva `.limit()`, con un `populate` per riga, su una
 * rotta che la barra laterale chiama a ogni caricamento di pagina. Il costo non
 * cresceva con quello che l'utente guarda ma con quanto ha usato il prodotto:
 * il modo sbagliato, perche' colpisce per primi gli utenti migliori.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Character = require('../models/Character');
const { signSession } = require('../services/session');

let mongoServer;
let utente, token, personaggio;

describe('Paginazione della cronologia', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Chat.deleteMany({}), Character.deleteMany({})]);

    utente = await User.create({
      email: 'assiduo@example.com', username: 'assiduo',
      birthdate: new Date('1990-01-01'), emailVerifiedAt: new Date()
    });
    token = signSession(utente);

    personaggio = await Character.create({
      name: 'Guida', description: 'Una guida paziente e disponibile',
      personality: 'Calma, precisa, non perde mai la pazienza con nessuno',
      avatar: 'https://example.com/a.png', createdBy: utente._id, isPublic: true
    });

    // Quaranta conversazioni, con attività distinta e decrescente.
    await Chat.insertMany(Array.from({ length: 40 }, (_, i) => ({
      userId: utente._id,
      characterId: personaggio._id,
      lastMessageAt: new Date(Date.now() - i * 60000)
    })));
  });

  const elenco = (query = {}) =>
    request(app).get('/api/chats').query(query).set('Authorization', `Bearer ${token}`);

  it('restituisce una pagina, non tutto', async () => {
    const res = await elenco();

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(30);
    expect(res.headers['x-has-more']).toBe('true');
  });

  it('la risposta resta un array: il client la legge così', async () => {
    // Trasformarla in un oggetto avrebbe svuotato la barra laterale senza
    // alcun errore visibile — array vuoto e oggetto sono entrambi «veri».
    const res = await elenco();
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('il cursore continua da dove si era fermati, senza ripetere', async () => {
    const prima = await elenco({ limit: 10 });
    const cursore = prima.headers['x-next-cursor'];
    expect(cursore).toBeDefined();

    const seconda = await elenco({ limit: 10, before: cursore });

    const idPrima = prima.body.map((c) => c._id);
    const idSeconda = seconda.body.map((c) => c._id);
    expect(seconda.body).toHaveLength(10);
    expect(idSeconda.some((id) => idPrima.includes(id))).toBe(false);
  });

  it('l ultima pagina dichiara che è finita', async () => {
    const res = await elenco({ limit: 50 });

    expect(res.body).toHaveLength(40);
    expect(res.headers['x-has-more']).toBe('false');
    expect(res.headers['x-next-cursor']).toBeUndefined();
  });

  it('un limite assurdo viene riportato entro il tetto', async () => {
    const res = await elenco({ limit: '100000' });
    expect(res.body.length).toBeLessThanOrEqual(50);
  });

  it('resta ordinata per ultima attività', async () => {
    const res = await elenco({ limit: 5 });
    const tempi = res.body.map((c) => new Date(c.lastMessageAt).getTime());

    expect(tempi).toEqual([...tempi].sort((a, b) => b - a));
  });

  it('non mostra le conversazioni di altri', async () => {
    const altro = await User.create({
      email: 'altro@example.com', username: 'altro',
      birthdate: new Date('1990-01-01'), emailVerifiedAt: new Date()
    });
    await Chat.create({ userId: altro._id, characterId: personaggio._id, lastMessageAt: new Date() });

    const res = await elenco({ limit: 50 });

    expect(res.body).toHaveLength(40);
  });
});
