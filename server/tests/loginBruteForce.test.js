/**
 * S13 — Il limite anti-brute-force sul login, finalmente verificabile.
 *
 * `loginLimiter` e `registerLimiter` avevano `skip: () => NODE_ENV === 'test'`
 * incondizionato: nessun test poteva accenderli, quindi la protezione più
 * importante dell'applicazione era l'unica priva di regressione. Si poteva
 * alzare `LOGIN_RATE_MAX` a mille, o togliere il middleware dalla rotta, e la
 * suite restava verde.
 *
 * `FORCE_RATE_LIMIT=1` è la stessa convenzione già usata da
 * `middleware/rateLimit.js` e da `tests/ratelimit.test.js`. Va impostata PRIMA
 * di importare il server, perché i limitatori si costruiscono all'import.
 */
process.env.FORCE_RATE_LIMIT = '1';
process.env.LOGIN_RATE_MAX = '3';
process.env.REGISTER_RATE_MAX = '2';

const request = require('supertest');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await User.create({
    email: 'vittima@example.com',
    username: 'vittima',
    authProvider: 'local',
    passwordHash: await bcrypt.hash('PasswordGiusta1', 10)
  });
}, 30000);

afterAll(async () => {
  delete process.env.FORCE_RATE_LIMIT;
  delete process.env.LOGIN_RATE_MAX;
  delete process.env.REGISTER_RATE_MAX;
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}, 30000);

describe('S13 — brute force sul login', () => {
  it('dopo N tentativi falliti la rotta risponde 429, non 401', async () => {
    const tentativo = () =>
      request(app).post('/api/auth/login').send({ email: 'vittima@example.com', password: 'Sbagliata1' });

    // I primi tentativi vengono valutati e respinti con le credenziali.
    for (let i = 0; i < 3; i++) {
      const res = await tentativo();
      expect(res.status).toBe(401);
    }

    // Il successivo non arriva nemmeno a bcrypt.
    const bloccato = await tentativo();
    expect(bloccato.status).toBe(429);
    expect(bloccato.body.error).toMatch(/Troppi tentativi/i);
  });

  it('il limitatore è montato sulla rotta, non solo definito', async () => {
    // La differenza conta: la stessa classe di difetto che `security.test.js`
    // verifica per la validazione dell'ambiente — «collegata al percorso, non
    // solo esistente».
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'vittima@example.com', password: 'PasswordGiusta1' });

    // Anche la password GIUSTA è bloccata finché la finestra non scade:
    // è la prova che il blocco precede la verifica delle credenziali.
    expect(res.status).toBe(429);
  });
});
