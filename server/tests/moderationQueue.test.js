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

    author = await User.create({
    emailVerifiedAt: new Date(), email: 'autore@example.com', username: 'autore', birthdate: yearsAgo(30) });
    reader = await User.create({
    emailVerifiedAt: new Date(), email: 'lettore@example.com', username: 'lettore', birthdate: yearsAgo(30) });
    moderator = await User.create({
    emailVerifiedAt: new Date(), email: 'mod@example.com', username: 'moderatore', role: 'moderator', birthdate: yearsAgo(35) });
    minor = await User.create({
    emailVerifiedAt: new Date(), email: 'giovane@example.com', username: 'giovane', birthdate: yearsAgo(15) });

    authorToken = tokenFor(author);
    readerToken = tokenFor(reader);
    moderatorToken = tokenFor(moderator);
    minorToken = tokenFor(minor);
  });

  // ---- S2-2 ----------------------------------------------------------------
  /**
   * Moderazione SUCCESSIVA.
   *
   * Questo blocco verificava il comportamento opposto: un personaggio pubblico
   * nasceva `pending` e restava invisibile finché una persona non lo approvava.
   * Era la scelta prudente sulla carta, e nella pratica significava che nessuno
   * vedeva mai i personaggi creati dagli altri — la coda non aveva un
   * moderatore, perché il ruolo si concede solo fuori banda con accesso al
   * database.
   *
   * Ciò che protegge resta e viene verificato qui sotto: il filtro automatico
   * sui metadati continua a stare PRIMA del salvataggio, la rimozione funziona,
   * e — questa è nuova — un personaggio rimosso non torna online modificandolo.
   */
  describe('S2-2 — un personaggio pubblico è visibile subito', () => {
    it('compare in galleria appena creato, senza attendere nessuno', async () => {
      const created = await as(request(app).post('/api/characters'), authorToken)
        .send(characterPayload({ isPublic: true }));

      expect(created.status).toBe(201);
      expect(created.body.moderationStatus).toBe('approved');

      const gallery = await request(app).get('/api/characters');
      expect(gallery.body.characters).toHaveLength(1);
    });

    it('ed è raggiungibile da un altro utente registrato e da un anonimo', async () => {
      const created = await as(request(app).post('/api/characters'), authorToken)
        .send(characterPayload({ isPublic: true }));

      const altroUtente = await as(request(app).get(`/api/characters/${created.body._id}`), readerToken);
      expect(altroUtente.status).toBe(200);

      const anonimo = await request(app).get(`/api/characters/${created.body._id}`);
      expect(anonimo.status).toBe(200);
    });

    it('un personaggio rimosso sparisce dalla galleria', async () => {
      const created = await as(request(app).post('/api/characters'), authorToken)
        .send(characterPayload({ isPublic: true }));

      await as(request(app).patch(`/api/admin/characters/${created.body._id}`), moderatorToken)
        .send({ moderationStatus: 'rejected', moderationReason: 'Viola le regole della piattaforma.' });

      const gallery = await request(app).get('/api/characters');
      expect(gallery.body.characters).toHaveLength(0);

      const terzo = await as(request(app).get(`/api/characters/${created.body._id}`), readerToken);
      expect(terzo.status).toBe(404);
    });

    it('e NON torna online se l\'autore lo modifica', async () => {
      // Senza questa regola la rimozione sarebbe un fastidio da aggirare
      // cambiando una virgola.
      const created = await as(request(app).post('/api/characters'), authorToken)
        .send(characterPayload({ isPublic: true }));

      await as(request(app).patch(`/api/admin/characters/${created.body._id}`), moderatorToken)
        .send({ moderationStatus: 'rejected', moderationReason: 'Viola le regole della piattaforma.' });

      const modificato = await as(request(app).put(`/api/characters/${created.body._id}`), authorToken)
        .send(characterPayload({ isPublic: true, description: 'Una descrizione completamente riscritta dopo la rimozione.' }));

      expect(modificato.body.moderationStatus).toBe('rejected');
      // Ma torna in coda, così un moderatore può riesaminarlo.
      expect(modificato.body.moderatedAt).toBeNull();

      const gallery = await request(app).get('/api/characters');
      expect(gallery.body.characters).toHaveLength(0);
    });

    it('un personaggio PRIVATO è approvato subito: non c\'è nulla da rivedere', async () => {
      const created = await as(request(app).post('/api/characters'), authorToken)
        .send(characterPayload({ isPublic: false }));

      expect(created.body.moderationStatus).toBe('approved');

      const chat = await as(request(app).post('/api/chats'), authorToken)
        .send({ characterId: created.body._id });
      expect(chat.status).toBe(201);
    });

    /**
     * Galleria e chat devono dire la stessa cosa.
     *
     * La regola di visibilità era scritta a mano in tre punti — la scheda, il
     * filtro della galleria e la creazione di una conversazione. Cambiandola in
     * due su tre, il difetto che ne usciva non somigliava alla sua causa: il
     * personaggio compariva in galleria, si apriva, mostrava «Nuova
     * conversazione», e il pulsante rispondeva 404. Ogni file letto da solo
     * sembrava corretto.
     */
    it('ciò che si vede in galleria si può aprire E si può chattare', async () => {
      const created = await as(request(app).post('/api/characters'), authorToken)
        .send(characterPayload({ isPublic: true }));

      const galleria = await request(app).get('/api/characters');
      const inGalleria = galleria.body.characters.map((c) => c._id);
      expect(inGalleria).toContain(created.body._id);

      for (const id of inGalleria) {
        const scheda = await as(request(app).get(`/api/characters/${id}`), readerToken);
        expect(scheda.status).toBe(200);

        const chat = await as(request(app).post('/api/chats'), readerToken).send({ characterId: id });
        expect([201, 403]).toContain(chat.status); // 403 solo per il cancello d'età
      }
    });

    it('un personaggio pubblico è chattabile da chiunque, subito', async () => {
      const created = await as(request(app).post('/api/characters'), authorToken)
        .send(characterPayload({ isPublic: true }));

      const res = await as(request(app).post('/api/chats'), readerToken)
        .send({ characterId: created.body._id });
      expect(res.status).toBe(201);
    });

    it('un personaggio rimosso non è chattabile da terzi', async () => {
      const created = await as(request(app).post('/api/characters'), authorToken)
        .send(characterPayload({ isPublic: true }));

      await as(request(app).patch(`/api/admin/characters/${created.body._id}`), moderatorToken)
        .send({ moderationStatus: 'rejected', moderationReason: 'Viola le regole della piattaforma.' });

      const res = await as(request(app).post('/api/chats'), readerToken)
        .send({ characterId: created.body._id });
      expect(res.status).toBe(404);
    });

    it('modificare un personaggio già esaminato lo rimanda in coda, restando online', async () => {
      const created = await as(request(app).post('/api/characters'), authorToken)
        .send(characterPayload({ isPublic: true }));

      await as(request(app).patch(`/api/admin/characters/${created.body._id}`), moderatorToken)
        .send({ moderationStatus: 'approved' });

      const updated = await as(request(app).put(`/api/characters/${created.body._id}`), authorToken)
        .send(characterPayload({ isPublic: true, description: 'Una descrizione completamente riscritta dopo l esame.' }));

      // Torna davanti a un moderatore...
      expect(updated.body.moderatedAt).toBeNull();
      // ...ma nel frattempo resta visibile: la revisione non blocca più nulla.
      expect(updated.body.moderationStatus).toBe('approved');

      const coda = await as(request(app).get('/api/admin/characters?status=da_rivedere'), moderatorToken);
      expect(coda.body.characters).toHaveLength(1);
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

    it('l\'esame lo toglie dalla coda e lo lascia in galleria', async () => {
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

      const coda = await as(request(app).get('/api/admin/characters?status=da_rivedere'), moderatorToken);
      expect(coda.body.characters).toHaveLength(0);
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
      const unknown = await User.create({
    emailVerifiedAt: new Date(), email: 'ignoto@example.com', username: 'ignoto' });
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
