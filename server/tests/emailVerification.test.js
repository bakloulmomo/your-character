/**
 * Conferma dell'indirizzo email.
 *
 * Prima non esisteva, e il codice lo dichiarava: «L'email, qui, non e'
 * un'identita' — e' una stringa che il richiedente sceglie». Ci si registrava
 * con l'indirizzo di un'altra persona, e il recupero password mandava a quella
 * persona posta mai richiesta.
 *
 * Si verificano tre cose distinte, e la terza e' quella che di solito manca:
 * che il codice funzioni; che il cancello sia MONTATO sulle rotte che devono
 * averlo; e che NON sia montato su quelle che devono restare aperte — un
 * cancello troppo largo si scopre solo quando gli utenti se ne vanno.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');
const Character = require('../models/Character');
const {
  issueVerificationCode, verifyCode, hashCode, MAX_ATTEMPTS, RESEND_COOLDOWN_MS
} = require('../services/emailVerification');

let mongoServer;

const tokenFor = (u) =>
  jwt.sign({ id: u._id, email: u.email, username: u.username, tv: u.tokenVersion || 0 },
    process.env.JWT_SECRET, { expiresIn: '1h' });

const creaUtente = (extra = {}) => User.create({
  email: 'nuovo@example.com', username: 'nuovo', authProvider: 'local',
  birthdate: new Date('1990-01-01'), credits: 50, ...extra
});

/** Impianta un codice noto senza passare dall'invio dell'email. */
const conCodice = async (user, code, { scadeFra = 15 * 60 * 1000 } = {}) => {
  await User.updateOne({ _id: user._id }, {
    $set: {
      emailVerificationCodeHash: hashCode(code),
      emailVerificationExpiresAt: new Date(Date.now() + scadeFra),
      emailVerificationAttempts: 0
    }
  });
};

describe('Conferma dell indirizzo email', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Character.deleteMany({})]);
  });

  // ── Il codice ─────────────────────────────────────────────────────────────
  describe('Il codice', () => {
    it('non viene mai salvato in chiaro', async () => {
      const u = await creaUtente();
      await issueVerificationCode(u);

      const salvato = await User.findById(u._id).select('+emailVerificationCodeHash');
      expect(salvato.emailVerificationCodeHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('quello giusto conferma l indirizzo', async () => {
      const u = await creaUtente();
      await conCodice(u, '123456');

      expect(await verifyCode(u._id, '123456')).toMatchObject({ ok: true });
      expect((await User.findById(u._id)).emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('quello sbagliato non conferma e consuma un tentativo', async () => {
      const u = await creaUtente();
      await conCodice(u, '123456');

      const esito = await verifyCode(u._id, '000000');

      expect(esito).toMatchObject({ ok: false, reason: 'codice_errato', attemptsLeft: MAX_ATTEMPTS - 1 });
      expect((await User.findById(u._id)).emailVerifiedAt).toBeNull();
    });

    it('quello scaduto viene distinto da quello sbagliato', async () => {
      const u = await creaUtente();
      await conCodice(u, '123456', { scadeFra: -1000 });

      // Motivi distinti perché chiedono due gesti diversi: chiederne uno nuovo,
      // oppure rileggere quello che si ha davanti.
      expect(await verifyCode(u._id, '123456')).toMatchObject({ ok: false, reason: 'scaduto' });
    });

    it('dopo il tetto di tentativi il codice è morto, anche se poi lo indovini', async () => {
      const u = await creaUtente();
      await conCodice(u, '123456');

      for (let i = 0; i < MAX_ATTEMPTS; i++) await verifyCode(u._id, '999999');

      expect(await verifyCode(u._id, '123456')).toMatchObject({ ok: false, reason: 'troppi_tentativi' });
      expect((await User.findById(u._id)).emailVerifiedAt).toBeNull();
    });

    it('un codice nuovo azzera il conto: chi sbaglia a digitare non resta chiuso fuori', async () => {
      const u = await creaUtente();
      await conCodice(u, '111111');
      for (let i = 0; i < MAX_ATTEMPTS; i++) await verifyCode(u._id, '999999');

      await issueVerificationCode(await User.findById(u._id).select('+emailVerificationSentAt'), { force: true });
      const fresco = await User.findById(u._id).select('+emailVerificationAttempts');

      expect(fresco.emailVerificationAttempts).toBe(0);
    });

    it('non si riusa: dopo la conferma il codice sparisce', async () => {
      const u = await creaUtente();
      await conCodice(u, '123456');
      await verifyCode(u._id, '123456');

      const dopo = await User.findById(u._id).select('+emailVerificationCodeHash');
      expect(dopo.emailVerificationCodeHash).toBeNull();
    });

    it('il rinvio ravvicinato viene frenato', async () => {
      const u = await creaUtente();
      await issueVerificationCode(u);
      const aggiornato = await User.findById(u._id).select('+emailVerificationSentAt');

      expect(await issueVerificationCode(aggiornato)).toMatchObject({ reason: 'troppo_presto' });
      expect(RESEND_COOLDOWN_MS).toBeGreaterThan(0);
    });
  });

  // ── La scadenza dell'account ──────────────────────────────────────────────
  describe('Account mai confermato', () => {
    it('nasce con una scadenza, e la perde quando viene confermato', async () => {
      const u = await creaUtente();
      await issueVerificationCode(u);

      expect((await User.findById(u._id)).unverifiedExpiresAt).toBeInstanceOf(Date);

      await conCodice(u, '123456');
      await verifyCode(u._id, '123456');

      // Senza questo azzeramento l'indice TTL cancellerebbe un account vero.
      expect((await User.findById(u._id)).unverifiedExpiresAt).toBeNull();
    });

    it('l indice TTL esiste sul campo giusto, e su nessun altro', async () => {
      const indici = await User.collection.indexes();
      const ttl = indici.filter((i) => typeof i.expireAfterSeconds === 'number');

      expect(ttl).toHaveLength(1);
      expect(ttl[0].key).toHaveProperty('unverifiedExpiresAt');
    });
  });

  // ── Le rotte ──────────────────────────────────────────────────────────────
  describe('Le rotte', () => {
    it('la registrazione dichiara che serve una conferma', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: 'iscritto@example.com', username: 'iscritto',
        password: 'Password1', birthdate: '1990-05-05'
      });

      expect(res.status).toBe(201);
      expect(res.body.requiresEmailVerification).toBe(true);
      expect(res.body.user.emailVerified).toBe(false);
    });

    it('rifiuta un codice che non è di sei cifre senza toccare il database', async () => {
      const u = await creaUtente();
      const res = await request(app).post('/api/auth/verify-email')
        .set('Authorization', `Bearer ${tokenFor(u)}`).send({ code: 'abc' });

      expect(res.status).toBe(400);
    });

    it('con il codice giusto risponde con l utente aggiornato', async () => {
      const u = await creaUtente();
      await conCodice(u, '654321');

      const res = await request(app).post('/api/auth/verify-email')
        .set('Authorization', `Bearer ${tokenFor(u)}`).send({ code: '654321' });

      expect(res.status).toBe(200);
      expect(res.body.user.emailVerified).toBe(true);
    });

    it('senza sessione non si conferma nulla', async () => {
      const res = await request(app).post('/api/auth/verify-email').send({ code: '123456' });
      expect(res.status).toBe(401);
    });
  });

  // ── Il cancello ───────────────────────────────────────────────────────────
  describe('Il cancello sulle rotte che costano', () => {
    let nonVerificato, token;

    beforeEach(async () => {
      nonVerificato = await creaUtente({ email: 'attesa@example.com', username: 'attesa' });
      token = tokenFor(nonVerificato);
    });

    const bloccata = async (metodo, url, corpo) => {
      const res = await request(app)[metodo](url)
        .set('Authorization', `Bearer ${token}`).send(corpo || {});
      expect(res.status).toBe(403);
      expect(res.body.requiresEmailVerification).toBe(true);
      return res;
    };

    it('non si aprono conversazioni', async () => {
      await bloccata('post', '/api/chats', { characterId: new mongoose.Types.ObjectId().toString() });
    });

    it('non si inviano messaggi', async () => {
      await bloccata('post', '/api/messages', {
        chatId: new mongoose.Types.ObjectId().toString(), content: 'ciao'
      });
    });

    it('non si inviano messaggi nemmeno in streaming', async () => {
      await bloccata('post', '/api/messages/stream', {
        chatId: new mongoose.Types.ObjectId().toString(), content: 'ciao'
      });
    });

    it('non si creano personaggi', async () => {
      await bloccata('post', '/api/characters', { name: 'Prova' });
    });

    /**
     * 403 e non 401: l'utente E' autenticato, gli manca un requisito. Con 401
     * l'intercettore del client lo disconnetterebbe, e si ritroverebbe fuori
     * senza capire perché.
     */
    it('risponde 403, non 401: non è una sessione scaduta', async () => {
      const res = await request(app).post('/api/chats')
        .set('Authorization', `Bearer ${token}`).send({ characterId: 'x' });

      expect(res.status).not.toBe(401);
    });
  });

  // ── Ciò che deve restare aperto ───────────────────────────────────────────
  describe('Ciò che resta aperto senza conferma', () => {
    let token;

    beforeEach(async () => {
      const u = await creaUtente({ email: 'curioso@example.com', username: 'curioso' });
      token = tokenFor(u);
    });

    it('il catalogo si guarda', async () => {
      const res = await request(app).get('/api/characters')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('il proprio profilo si legge', async () => {
      const res = await request(app).get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.user.emailVerified).toBe(false);
    });

    it('si può chiedere un altro codice', async () => {
      const res = await request(app).post('/api/auth/resend-verification')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });
  });
});
