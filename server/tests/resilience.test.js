/**
 * Tenuta: la sonda di salute e il parser della querystring.
 *
 * Due difese che hanno in comune il modo in cui fallivano — in silenzio, e
 * proprio nel momento in cui servivano.
 *
 * La sonda rispondeva `200 ok` incondizionatamente: un processo vivo con il
 * database irraggiungibile si dichiarava sano, quindi l'hosting lo teneva in
 * rotazione mentre ogni richiesta rispondeva 500. Una sonda che non puo'
 * fallire non e' una sonda.
 *
 * Il parser accettava OGGETTI dalla querystring (`?tag[$ne]=x`), e ogni rotta
 * doveva ricordarsi di neutralizzarli una per una. La disciplina riga per riga
 * regge finche' qualcuno non scrive la rotta successiva di fretta.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const Character = require('../models/Character');
const User = require('../models/User');

let mongoServer;

describe('Tenuta del servizio', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  describe('Sonda di salute', () => {
    it('con il database connesso risponde 200 e lo dichiara', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok', database: 'connected' });
    });

    /**
     * Il caso per cui la sonda esiste. Si simula lo stato della connessione
     * invece di chiuderla davvero: chiudere il database sotto i piedi degli
     * altri test in parallelo sarebbe una cura peggiore del male.
     */
    it('con il database irraggiungibile risponde 503, non 200', async () => {
      const descrittore = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(mongoose.connection), 'readyState'
      );
      Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });

      const res = await request(app).get('/health');

      delete mongoose.connection.readyState;
      if (descrittore) Object.defineProperty(Object.getPrototypeOf(mongoose.connection), 'readyState', descrittore);

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ status: 'degraded', database: 'disconnected' });
    });

    /**
     * Rotta pubblica e non limitata: non deve raccontare com'e' configurato
     * l'ambiente a chi non ha gia' accesso ai log.
     */
    it('non rivela quale ambiente sta girando', async () => {
      const res = await request(app).get('/health');

      expect(res.body.env).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/production|development|test/);
    });
  });

  describe('Operatori Mongo nella querystring', () => {
    beforeEach(async () => {
      await Promise.all([Character.deleteMany({}), User.deleteMany({})]);
    });

    const creaPubblico = async () => {
      const autore = await User.create({
    emailVerifiedAt: new Date(),
        email: 'autore@example.com', username: 'autore', birthdate: new Date('1990-01-01')
      });
      return Character.create({
        name: 'Visibile', description: 'Un personaggio pubblico di prova',
        personality: 'Cordiale e disponibile, parla volentieri di tutto',
        avatar: 'https://example.com/a.png', createdBy: autore._id,
        isPublic: true, tags: ['fantasy']
      });
    };

    /**
     * Con il parser esteso `?tag[$ne]=fantasy` diventava `{ $ne: 'fantasy' }`
     * e finiva dentro il filtro come OPERATORE. Con il parser semplice la
     * chiave resta la stringa letterale `tag[$ne]`, quindi `req.query.tag` non
     * esiste proprio: il parametro ostile non viene ignorato per disciplina di
     * chi ha scritto la rotta, ma perche' non e' mai diventato un parametro.
     */
    it('un operatore travestito da parametro non entra nel filtro', async () => {
      await creaPubblico();

      const res = await request(app).get('/api/characters').query({ 'tag[$ne]': 'fantasy' });

      expect(res.status).toBe(200);
      // Nessuna esclusione: l'operatore non ha filtrato nulla.
      expect(res.body.characters).toHaveLength(1);
    });

    it('un filtro per tag legittimo continua a filtrare', async () => {
      await creaPubblico();

      const combacia = await request(app).get('/api/characters').query({ tag: 'fantasy' });
      const nonCombacia = await request(app).get('/api/characters').query({ tag: 'gaming' });

      expect(combacia.body.characters).toHaveLength(1);
      expect(nonCombacia.body.characters).toHaveLength(0);
    });

    it('non solleva un 500 su una ricerca costruita come oggetto', async () => {
      const res = await request(app).get('/api/characters').query({ 'search[$regex]': '.*' });

      expect(res.status).toBe(200);
    });

    it('un parametro normale continua a funzionare', async () => {
      const res = await request(app).get('/api/characters').query({ category: 'fantasy', limit: '5' });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.characters)).toBe(true);
    });
  });
});
