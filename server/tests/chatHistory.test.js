/**
 * La cronologia delle conversazioni: ordine e conteggi.
 *
 * Tre difetti che nessun test copriva, tutti trovati misurando il
 * comportamento invece di leggere il codice.
 *
 *  1. `GET /chats` ordinava per `updatedAt`, ma `updatedAt` non si muoveva MAI
 *     dopo la creazione: il hook che lo aggiorna era un `pre('save')`, mentre
 *     ogni messaggio inviato scrive con `findByIdAndUpdate`, che non lo esegue.
 *     Risultato: la cronologia era ordinata per data di APERTURA. Rispondere a
 *     una vecchia conversazione non la faceva risalire, e la riga restava sotto
 *     una chat mai toccata pur mostrandole accanto «questo minuto».
 *
 *  2. `chatCount` — il numero mostrato in galleria come «N conversazioni» —
 *     veniva incrementato all'apertura e non decrementato da nessun percorso:
 *     né dall'eliminazione di una chat, né dalla cancellazione di un account.
 *     Poteva solo crescere, quindi si allontanava dalla realtà per sempre.
 *
 *  3. Sulla rotta di STREAMING — l'unica che il client usa davvero — un guasto
 *     del modello non aggiornava `messageCount` né `lastMessageAt`, benché il
 *     messaggio dell'utente fosse già stato salvato.
 */
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Character = require('../models/Character');
const Message = require('../models/Message');

let mongoServer;

const tokenFor = (user) => jwt.sign({ id: user._id, tv: user.tokenVersion || 0 }, process.env.JWT_SECRET);

const makeCharacter = (owner, over = {}) =>
  Character.create({
    name: 'Aria Thorne',
    description: 'Coach di scrittura per autori e sceneggiatori.',
    personality: 'Brillante, empatica e metodica nel dare consigli.',
    avatar: 'https://example.com/aria.jpg',
    createdBy: owner._id,
    isPublic: true,
    moderationStatus: 'approved',
    ...over
  });

describe('cronologia delle conversazioni', () => {
  let user;
  let token;
  let character;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 60000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 60000);

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}), Chat.deleteMany({}), Character.deleteMany({}), Message.deleteMany({})
    ]);
    user = await User.create({
    emailVerifiedAt: new Date(),
      email: 'anna@example.com', username: 'anna', birthdate: new Date('1990-01-01')
    });
    token = tokenFor(user);
    character = await makeCharacter(user);
  });

  describe('ordinamento', () => {
    it('la conversazione con il messaggio più recente viene per prima', async () => {
      const vecchia = await Chat.create({ userId: user._id, characterId: character._id, title: 'aperta prima' });
      await new Promise((r) => setTimeout(r, 20));
      await Chat.create({ userId: user._id, characterId: character._id, title: 'aperta dopo' });

      // Arriva un messaggio nella conversazione APERTA PRIMA: da questo momento
      // è la più recente per attività, e deve stare in cima.
      await new Promise((r) => setTimeout(r, 20));
      await Chat.findByIdAndUpdate(vecchia._id, {
        $inc: { messageCount: 2 },
        lastMessageAt: new Date()
      });

      const res = await request(app).get('/api/chats').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.map((c) => c.title)).toEqual(['aperta prima', 'aperta dopo']);
    });

    it('`updatedAt` si muove anche quando si scrive per query, non solo con save()', async () => {
      const chat = await Chat.create({ userId: user._id, characterId: character._id });
      const creato = (await Chat.findById(chat._id).lean()).updatedAt;

      await new Promise((r) => setTimeout(r, 20));
      await Chat.findByIdAndUpdate(chat._id, { $inc: { messageCount: 1 }, lastMessageAt: new Date() });

      const dopo = (await Chat.findById(chat._id).lean()).updatedAt;
      expect(dopo.getTime()).toBeGreaterThan(creato.getTime());
    });
  });

  describe('conteggio delle conversazioni sul personaggio', () => {
    it('sale aprendo una chat e scende eliminandola', async () => {
      const aperta = await request(app)
        .post('/api/chats')
        .set('Authorization', `Bearer ${token}`)
        .send({ characterId: character._id.toString() });
      expect(aperta.status).toBe(201);
      expect((await Character.findById(character._id)).chatCount).toBe(1);

      const eliminata = await request(app)
        .delete(`/api/chats/${aperta.body._id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(eliminata.status).toBe(200);

      expect((await Character.findById(character._id)).chatCount).toBe(0);
    });

    it('non scende sotto zero se il contatore è già a zero', async () => {
      // Dati preesistenti a questa correzione possono avere un contatore
      // disallineato: il rimedio non deve produrre numeri negativi.
      const chat = await Chat.create({ userId: user._id, characterId: character._id });
      await Character.findByIdAndUpdate(character._id, { chatCount: 0 });

      await request(app).delete(`/api/chats/${chat._id}`).set('Authorization', `Bearer ${token}`);

      expect((await Character.findById(character._id)).chatCount).toBe(0);
    });

    it('cancellando un account scendono tutte le conversazioni che aveva aperto', async () => {
      // Il personaggio è di QUALCUN ALTRO ed è pubblico: sopravvive alla
      // cancellazione, quindi il suo contatore resterebbe gonfio per sempre.
      const altro = await User.create({
    emailVerifiedAt: new Date(),
        email: 'bruno@example.com', username: 'bruno', birthdate: new Date('1988-05-05')
      });
      const suo = await makeCharacter(altro, { name: 'Marcus Vance' });

      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/chats')
          .set('Authorization', `Bearer ${token}`)
          .send({ characterId: suo._id.toString() });
      }
      expect((await Character.findById(suo._id)).chatCount).toBe(3);

      const eliminato = await request(app).delete('/api/users/me').set('Authorization', `Bearer ${token}`);
      expect(eliminato.status).toBe(200);

      expect((await Character.findById(suo._id)).chatCount).toBe(0);
      // Il personaggio pubblico di un altro utente resta in galleria.
      expect(await Character.findById(suo._id)).not.toBeNull();
    });
  });

  describe('guasto del modello sulla rotta di streaming', () => {
    it('il messaggio salvato viene contato e la chat risale in cronologia', async () => {
      /**
       * È il percorso che gli utenti attraversano davvero: il client invia
       * sempre da `/messages/stream`. Il messaggio dell'utente viene salvato
       * PRIMA della chiamata al modello, quindi se il modello fallisce quel
       * messaggio esiste comunque — e la conversazione deve saperlo.
       */
      // `AI_MODE=fail` è l'interruttore che il servizio stesso espone per
      // simulare un guasto del modello: la rotta importa la funzione al
      // require, quindi sostituirla a posteriori non avrebbe alcun effetto.
      process.env.AI_MODE = 'fail';

      const chat = await Chat.create({ userId: user._id, characterId: character._id });
      const prima = await Chat.findById(chat._id).lean();
      await new Promise((r) => setTimeout(r, 20));

      const res = await request(app)
        .post('/api/messages/stream')
        .set('Authorization', `Bearer ${token}`)
        .send({ chatId: chat._id.toString(), content: 'Ciao, mi aiuti con un racconto?' });

      /**
       * Lo stato HTTP è 200 anche quando il modello fallisce: le intestazioni
       * partono con il primo evento SSE, molto prima della chiamata al modello.
       * Il guasto viaggia quindi DENTRO il flusso, come evento `error` — ed è
       * esattamente così che il client lo legge.
       */
      expect(res.status).toBe(200);
      expect(res.text).toContain('"error"');

      const salvati = await Message.countDocuments({ chatId: chat._id });
      const dopo = await Chat.findById(chat._id).lean();

      // Il messaggio dell'utente è in archivio…
      expect(salvati).toBe(1);
      // …quindi il conteggio deve rifletterlo…
      expect(dopo.messageCount).toBe(prima.messageCount + 1);
      // …e la conversazione deve essere risalita in cima.
      expect(dopo.lastMessageAt.getTime()).toBeGreaterThan(prima.lastMessageAt.getTime());

      delete process.env.AI_MODE;
    });
  });
});
