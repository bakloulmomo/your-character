/**
 * Il `systemPrompt` non deve uscire dalla API.
 *
 * Difetto trovato in revisione: `GET /api/chats/:id` faceva
 * `.populate('characterId')` senza proiezione, quindi restituiva le istruzioni
 * complete di qualunque personaggio pubblico a chiunque aprisse una chat.
 * Tutte le altre rotte lo escludevano a mano con `-systemPrompt`, e questa se
 * n'era semplicemente dimenticata.
 *
 * Il rimedio è strutturale (`select: false` sul modello), ma la protezione
 * strutturale va verificata dal FUORI, dalla superficie che un attaccante usa
 * davvero: questi test guardano il corpo della risposta HTTP, non il modello.
 * Così restano validi anche se un giorno l'implementazione cambia di nuovo.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');
const Character = require('../models/Character');
const Chat = require('../models/Chat');
const Message = require('../models/Message');

const SEGRETO = 'ISTRUZIONI-RISERVATE-DEL-PERSONAGGIO-42';

let mongoServer;
let autore;
let estraneo;
let tokenEstraneo;
let tokenAutore;
let personaggio;

const tokenFor = (user) =>
  jwt.sign(
    { id: user._id, email: user.email, username: user.username, tv: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

/** Cerca il segreto ovunque nella risposta, a qualunque profondità. */
const contieneIlPrompt = (body) => JSON.stringify(body).includes(SEGRETO);

describe('Il systemPrompt non esce dalla API', () => {
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
      User.deleteMany({}), Character.deleteMany({}), Chat.deleteMany({}), Message.deleteMany({})
    ]);

    autore = await User.create({
      email: 'autore@example.com', username: 'autore', authProvider: 'local',
      birthdate: new Date('1990-01-01')
    });
    estraneo = await User.create({
      email: 'estraneo@example.com', username: 'estraneo', authProvider: 'local',
      birthdate: new Date('1990-01-01'), credits: 50
    });
    tokenAutore = tokenFor(autore);
    tokenEstraneo = tokenFor(estraneo);

    personaggio = await Character.create({
      name: 'Marcus', description: 'Un netrunner con istruzioni riservate.',
      personality: 'Cinico, parla per mezze frasi e non si fida di nessuno.',
      avatar: 'https://example.com/m.jpg', category: 'roleplay',
      isPublic: true, moderationStatus: 'approved',
      createdBy: autore._id,
      systemPrompt: SEGRETO
    });
  });

  it('GET /api/chats/:id non lo espone — era la falla', async () => {
    const creata = await request(app)
      .post('/api/chats')
      .set('Authorization', `Bearer ${tokenEstraneo}`)
      .send({ characterId: personaggio._id.toString() });
    expect(creata.status).toBe(201);

    const res = await request(app)
      .get(`/api/chats/${creata.body._id}`)
      .set('Authorization', `Bearer ${tokenEstraneo}`);

    expect(res.status).toBe(200);
    expect(contieneIlPrompt(res.body)).toBe(false);
  });

  it('GET /api/chats non lo espone', async () => {
    await request(app)
      .post('/api/chats')
      .set('Authorization', `Bearer ${tokenEstraneo}`)
      .send({ characterId: personaggio._id.toString() });

    const res = await request(app).get('/api/chats').set('Authorization', `Bearer ${tokenEstraneo}`);
    expect(res.status).toBe(200);
    expect(contieneIlPrompt(res.body)).toBe(false);
  });

  it('GET /api/characters/:id non lo espone, nemmeno al suo autore', async () => {
    const res = await request(app)
      .get(`/api/characters/${personaggio._id}`)
      .set('Authorization', `Bearer ${tokenAutore}`);
    expect(res.status).toBe(200);
    expect(contieneIlPrompt(res.body)).toBe(false);
  });

  it('la galleria e «i miei personaggi» non lo espongono', async () => {
    for (const url of ['/api/characters', '/api/characters/my-characters']) {
      const res = await request(app).get(url).set('Authorization', `Bearer ${tokenAutore}`);
      expect(res.status).toBe(200);
      expect(contieneIlPrompt(res.body)).toBe(false);
    }
  });

  it('creare e modificare un personaggio non lo restituisce nella risposta', async () => {
    const corpo = {
      name: 'Nuovo', description: 'Una descrizione sufficientemente lunga.',
      personality: 'Una personalità scritta con almeno venti caratteri.',
      avatar: 'https://example.com/n.jpg'
    };

    const creato = await request(app)
      .post('/api/characters').set('Authorization', `Bearer ${tokenAutore}`).send(corpo);
    expect(creato.status).toBe(201);
    expect(creato.body.systemPrompt).toBeUndefined();

    const modificato = await request(app)
      .put(`/api/characters/${creato.body._id}`)
      .set('Authorization', `Bearer ${tokenAutore}`)
      .send({ ...corpo, description: 'Una descrizione diversa ma altrettanto lunga.' });
    expect(modificato.status).toBe(200);
    expect(modificato.body.systemPrompt).toBeUndefined();
  });

  // Il contenimento non deve rompere ciò che il prompt serve a fare: se il
  // personaggio smettesse di ricevere le proprie istruzioni, la protezione
  // avrebbe funzionato distruggendo il prodotto.
  it('ma il modello continua a ricevere le istruzioni del personaggio', async () => {
    const { buildContext } = require('../services/contextManager');
    const chat = await Chat.create({ userId: estraneo._id, characterId: personaggio._id, title: 'x' });
    const conPrompt = await Character.findById(personaggio._id).select('+systemPrompt');

    const contesto = await buildContext(chat, conPrompt);
    expect(contesto[0].role).toBe('system');
    expect(contesto[0].content).toContain(SEGRETO);
  });

  it('e chi modera lo vede, perché è esattamente ciò che deve esaminare', async () => {
    await User.findByIdAndUpdate(autore._id, { role: 'admin' });
    await Character.findByIdAndUpdate(personaggio._id, { moderationStatus: 'pending' });

    const res = await request(app)
      .get('/api/admin/characters?status=pending')
      .set('Authorization', `Bearer ${tokenFor(await User.findById(autore._id))}`);

    expect(res.status).toBe(200);
    expect(contieneIlPrompt(res.body)).toBe(true);
  });
});
