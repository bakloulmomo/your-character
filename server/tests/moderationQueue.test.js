/**
 * FASE D — Coda di revisione, segnalazioni e contenuti per adulti.
 *
 * Codifica S2-2, S2-3 e S2-13:
 *  · pubblicare non è più un click su una casella preselezionata;
 *  · le segnalazioni hanno un posto dove essere lette, e non si duplicano;
 *  · i contenuti per adulti non finiscono davanti a visitatori anonimi.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');
const Character = require('../models/Character');
const Chat = require('../models/Chat');
const Report = require('../models/Report');

let mongoServer;
let author, reader, moderator, minor;
let authorToken, readerToken, moderatorToken, minorToken;

const tokenFor = (u) =>
  jwt.sign(
    { id: u._id, email: u.email, username: u.username, tv: u.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

const as = (req, t) => req.set('Authorization', `Bearer ${t}`);

const yearsAgo = (n) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d;
};

const characterPayload = (overrides = {}) => ({
  name: 'Nuovo Personaggio',
  description: 'Una descrizione onesta e sufficientemente lunga per il catalogo.',
  personality: 'Curioso, disponibile e sempre pronto a una buona conversazione con chiunque.',
  avatar: 'https://example.com/avatar.jpg',
  ...overrides
});

describe('FASE D — Revisione, segnalazioni e contenuti per adulti', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    await Report.syncIndexes();
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}), Character.deleteMany({}), Chat.deleteMany({}), Report.deleteMany({})
    ]);

    author = await User.create({ email: 'autore@example.com', username: 'autore', birthdate: yearsAgo(30) });
    reader = await User.create({ email: 'lettore@example.com', username: 'lettore', birthdate: yearsAgo(30) });
    moderator = await User.create({ email: 'mod@example.com', username: 'moderatore', role: 'moderator', birthdate: yearsAgo(35) });
    minor = await User.create({ email: 'giovane@example.com', username: 'giovane', birthdate: yearsAgo(15) });

    authorToken = tokenFor(author);
    readerToken = tokenFor(reader);
    moderatorToken = tokenFor(moderator);
    minorToken = tokenFor(minor);
  });

  // ---- S2-2 ----------------------------------------------------------------
  describe('S2-2 — pubblicare richiede una revisione', () => {
    it('un personaggio pubblico nasce in attesa e NON compare in galleria', async () => {
      const created = await as(request(app).post('/api/characters'), authorToken)
        .send(characterPayload({ isPublic: true }));

      expect(created.status).toBe(201);
      expect(created.body.moderationStatus).toBe('pending');

      const gallery = await request(app).get('/api/characters');
      expect(gallery.body.characters).toHaveLength(0);
    });

    it('ma resta visibile al suo autore, che deve poterlo ritrovare', async () => {
      const created = await as(request(app).post('/api/characters'), authorToken)
        .send(characterPayload({ isPublic: true }));

      const own = await as(request(app).get(`/api/characters/${created.body._id}`), authorToken);
      expect(own.status).toBe(200);

      const stranger = await as(request(app).get(`/api/characters/${created.body._id}`), readerToken);
      expect(stranger.status).toBe(404);
    });

    it('un personaggio PRIVATO è approvato subito: non c\'è nulla da rivedere', async () => {
      const created = await as(request(app).post('/api/characters'), authorToken)
        .send(characterPayload({ isPublic: false }));

      expect(created.body.moderationStatus).toBe('approved');

      const chat = await as(request(app).post('/api/chats'), authorToken)
        .send({ characterId: created.body._id });
      expect(chat.status).toBe(201);
    });

    it('un personaggio in attesa non è chattabile da terzi', async () => {
      const created = await as(request(app).post('/api/characters'), authorToken)
        .send(characterPayload({ isPublic: true }));

      const res = await as(request(app).post('/api/chats'), readerToken)
        .send({ characterId: created.body._id });
      expect(res.status).toBe(404);
    });

    it('modificare un personaggio già approvato lo rimanda in coda', async () => {
      const created = await as(request(app).post('/api/characters'), authorToken)
        .send(characterPayload({ isPublic: true }));

      await as(request(app).patch(`/api/admin/characters/${created.body._id}`), moderatorToken)
        .send({ moderationStatus: 'approved' });

      const updated = await as(request(app).put(`/api/characters/${created.body._id}`), authorToken)
        .send(characterPayload({ isPublic: true, description: 'Una descrizione completamente riscritta dopo l approvazione.' }));

      expect(updated.body.moderationStatus).toBe('pending');
    });
  });

  // ---- S2-13 — coda di moderazione -----------------------------------------
  describe('S2-13 — la coda esiste ed è protetta', () => {
    it('un utente qualunque non vede nemmeno che il pannello esiste', async () => {
      const res = await as(request(app).get('/api/admin/reports'), readerToken);
      expect(res.status).toBe(404);
    });

    it('una richiesta anonima è respinta', async () => {
      const res = await request(app).get('/api/admin/reports');
      expect(res.status).toBe(401);
    });

    it('un moderatore vede la coda dei personaggi da rivedere', async () => {
      await as(request(app).post('/api/characters'), authorToken).send(characterPayload({ isPublic: true }));

      const res = await as(request(app).get('/api/admin/characters?status=pending'), moderatorToken);
      expect(res.status).toBe(200);
      expect(res.body.characters).toHaveLength(1);
      // Il testo che decide il comportamento del personaggio è ciò che va
      // esaminato: nella coda di revisione deve esserci.
      expect(res.body.characters[0].systemPrompt).toBeTruthy();
    });

    it('l\'approvazione fa comparire il personaggio in galleria', async () => {
      const created = await as(request(app).post('/api/characters'), authorToken)
        .send(characterPayload({ isPublic: true }));

      const approved = await as(request(app).patch(`/api/admin/characters/${created.body._id}`), moderatorToken)
        .send({ moderationStatus: 'approved' });

      expect(approved.status).toBe(200);
      expect(approved.body.moderatedBy).toBeTruthy();
      // Il prompt non esce mai dalla API, nemmeno dalla risposta di moderazione.
      expect(approved.body.systemPrompt).toBeUndefined();

      const gallery = await request(app).get('/api/characters');
      expect(gallery.body.characters).toHaveLength(1);
    });

    it('respingere senza motivazione non è ammesso', async () => {
      const created = await as(request(app).post('/api/characters'), authorToken)
        .send(characterPayload({ isPublic: true }));

      const res = await as(request(app).patch(`/api/admin/characters/${created.body._id}`), moderatorToken)
        .send({ moderationStatus: 'rejected' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('motivazione');
    });

    it('il riepilogo dice quanto lavoro c\'è in coda', async () => {
      await as(request(app).post('/api/characters'), authorToken).send(characterPayload({ isPublic: true }));

      const res = await as(request(app).get('/api/admin/overview'), moderatorToken);
      expect(res.status).toBe(200);
      expect(res.body.pendingCharacters).toBe(1);
    });

    it('solo un amministratore può sospendere un account, e la sospensione chiude le sessioni aperte', async () => {
      const denied = await as(request(app).post(`/api/admin/users/${reader._id}/ban`), moderatorToken)
        .send({ reason: 'prova' });
      expect(denied.status).toBe(404);

      await User.findByIdAndUpdate(moderator._id, { role: 'admin' });

      const res = await as(request(app).post(`/api/admin/users/${reader._id}/ban`), moderatorToken)
        .send({ reason: 'Contenuti ripetutamente vietati' });
      expect(res.status).toBe(200);

      // Il token emesso prima della sospensione non deve più funzionare.
      const afterBan = await as(request(app).get('/api/auth/me'), readerToken);
      expect(afterBan.status).toBe(401);
    });
  });

  // ---- S2-13 — deduplica delle segnalazioni --------------------------------
  describe('S2-13 — le segnalazioni non si duplicano', () => {
    let target;

    beforeEach(async () => {
      target = await Character.create({
        name: 'Bersaglio',
        description: 'Un personaggio pubblico che qualcuno vorrà segnalare.',
        personality: 'Provocatorio quanto basta per finire nel mirino di qualcuno.',
        avatar: 'https://example.com/t.jpg',
        isPublic: true,
        moderationStatus: 'approved',
        createdBy: author._id
      });
    });

    it('cinquanta invii identici producono UNA sola segnalazione', async () => {
      const payload = { targetType: 'character', targetId: target._id.toString(), reason: 'spam' };

      const responses = await Promise.all(
        Array.from({ length: 50 }, () =>
          as(request(app).post('/api/reports'), readerToken).send(payload)
        )
      );

      expect(responses.every((r) => r.status === 201 || r.status === 200)).toBe(true);
      expect(await Report.countDocuments({ source: 'user' })).toBe(1);
    });

    it('il secondo invio lo dice apertamente invece di fingere un nuovo caso', async () => {
      const payload = { targetType: 'character', targetId: target._id.toString(), reason: 'spam' };
      await as(request(app).post('/api/reports'), readerToken).send(payload);

      const second = await as(request(app).post('/api/reports'), readerToken).send(payload);
      expect(second.status).toBe(200);
      expect(second.body.duplicate).toBe(true);
    });

    it('la deduplica regge anche senza l\'indice unico sul database', async () => {
      // L'indice è la difesa contro le richieste simultanee, ma non deve essere
      // l'unica: su un database ripristinato o migrato a mano potrebbe non
      // esserci, e i duplicati tornerebbero a passare senza che nulla fallisca.
      await Report.collection.dropIndexes().catch(() => {});

      const payload = { targetType: 'character', targetId: target._id.toString(), reason: 'spam' };
      await as(request(app).post('/api/reports'), readerToken).send(payload);
      const second = await as(request(app).post('/api/reports'), readerToken).send(payload);

      expect(second.body.duplicate).toBe(true);
      expect(await Report.countDocuments({ source: 'user' })).toBe(1);

      await Report.syncIndexes();
    });

    it('persone diverse possono segnalare lo stesso contenuto', async () => {
      const payload = { targetType: 'character', targetId: target._id.toString(), reason: 'spam' };
      await as(request(app).post('/api/reports'), readerToken).send(payload);
      await as(request(app).post('/api/reports'), moderatorToken).send(payload);

      expect(await Report.countDocuments({ source: 'user' })).toBe(2);
    });

    it('non si può segnalare un contenuto che non esiste', async () => {
      const res = await as(request(app).post('/api/reports'), readerToken).send({
        targetType: 'character',
        targetId: new mongoose.Types.ObjectId().toString(),
        reason: 'spam'
      });
      expect(res.status).toBe(404);
    });

    it('la segnalazione registra a chi appartiene il contenuto, così chi esamina non deve cercarlo', async () => {
      await as(request(app).post('/api/reports'), readerToken)
        .send({ targetType: 'character', targetId: target._id.toString(), reason: 'hate_speech' });

      const res = await as(request(app).get('/api/admin/reports'), moderatorToken);
      expect(res.body.reports[0].targetOwnerId.username).toBe('autore');
    });

    it('una segnalazione esaminata esce dalla coda dei pendenti', async () => {
      const created = await as(request(app).post('/api/reports'), readerToken)
        .send({ targetType: 'character', targetId: target._id.toString(), reason: 'spam' });

      await as(request(app).patch(`/api/admin/reports/${created.body.reportId}`), moderatorToken)
        .send({ status: 'dismissed', resolutionNote: 'Nessuna violazione riscontrata.' });

      const pending = await as(request(app).get('/api/admin/reports?status=pending'), moderatorToken);
      expect(pending.body.reports).toHaveLength(0);
    });
  });

  // ---- S2-3 — contenuti per adulti -----------------------------------------
  describe('S2-3 — i contenuti per adulti hanno un age gate reale', () => {
    let adultCharacter;

    beforeEach(async () => {
      adultCharacter = await Character.create({
        name: 'Notturna',
        description: 'Un personaggio destinato a un pubblico adulto e consapevole.',
        personality: 'Diretta, ironica e senza troppi giri di parole con chi la incontra.',
        avatar: 'https://example.com/n.jpg',
        isPublic: true,
        isNSFW: true,
        moderationStatus: 'approved',
        createdBy: author._id
      });
    });

    it('un visitatore anonimo non li vede in galleria', async () => {
      const res = await request(app).get('/api/characters');
      expect(res.body.characters).toHaveLength(0);
    });

    it('un maggiorenne che non li ha richiesti non li vede', async () => {
      const res = await as(request(app).get('/api/characters'), readerToken);
      expect(res.body.characters).toHaveLength(0);
    });

    it('un maggiorenne che li ha attivati li vede', async () => {
      await as(request(app).patch('/api/users/me/preferences'), readerToken).send({ nsfwEnabled: true });

      const res = await as(request(app).get('/api/characters'), readerToken);
      expect(res.body.characters).toHaveLength(1);
    });

    it('un minorenne non può attivarli', async () => {
      const res = await as(request(app).patch('/api/users/me/preferences'), minorToken)
        .send({ nsfwEnabled: true });

      expect(res.status).toBe(403);
      expect(res.body.requiresAgeVerification).toBe(true);
      expect((await User.findById(minor._id)).nsfwEnabled).toBe(false);
    });

    it('nemmeno chi non ha dichiarato una data di nascita', async () => {
      const unknown = await User.create({ email: 'ignoto@example.com', username: 'ignoto' });
      const res = await as(request(app).patch('/api/users/me/preferences'), tokenFor(unknown))
        .send({ nsfwEnabled: true });
      expect(res.status).toBe(403);
    });

    it('il link diretto non aggira il filtro', async () => {
      const anonymous = await request(app).get(`/api/characters/${adultCharacter._id}`);
      expect(anonymous.status).toBe(403);
      expect(anonymous.body.requiresAgeVerification).toBe(true);

      const asMinor = await as(request(app).get(`/api/characters/${adultCharacter._id}`), minorToken);
      expect(asMinor.status).toBe(403);
    });

    it('nemmeno l\'apertura di una chat lo aggira', async () => {
      const res = await as(request(app).post('/api/chats'), readerToken)
        .send({ characterId: adultCharacter._id.toString() });
      expect(res.status).toBe(403);
    });

    it('l\'autore vede sempre il proprio personaggio', async () => {
      const res = await as(request(app).get(`/api/characters/${adultCharacter._id}`), authorToken);
      expect(res.status).toBe(200);
    });

    it('un minorenne non può nemmeno PUBBLICARE contenuti per adulti', async () => {
      const res = await as(request(app).post('/api/characters'), minorToken)
        .send(characterPayload({ isNSFW: true, isPublic: true }));
      expect(res.status).toBe(403);
    });
  });
});
