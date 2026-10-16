/**
 * Le scadenze promesse nell'informativa devono avvenire.
 *
 * `PrivacyPage` dichiara agli utenti tre periodi di conservazione. Erano
 * promesse senza esecutore: nessun indice TTL, nessun job. Un periodo scritto
 * nell'informativa e non applicato nel codice e' una dichiarazione falsa resa
 * all'interessato — e nessun test se ne accorgeva, perche' verificare una
 * cancellazione richiede di far passare del tempo apposta.
 *
 * Qui si verificano anche i due CONFINI, che sono la parte che si sbaglia:
 * la pulizia non deve toccare i token ancora validi, ne' le segnalazioni
 * ancora aperte.
 */
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../models/User');
const Report = require('../models/Report');
const {
  runRetentionSweep,
  purgeExpiredResetTokens,
  purgeOldClosedReports,
  scheduleRetention,
  REPORT_RETENTION_MS
} = require('../services/retention');

let mongoServer;

const oreFa = (n) => new Date(Date.now() - n * 3600 * 1000);
const oreAvanti = (n) => new Date(Date.now() + n * 3600 * 1000);
const giorniFa = (n) => new Date(Date.now() - n * 24 * 3600 * 1000);

const utente = (extra) => User.create({
    emailVerifiedAt: new Date(),
  email: `u${Math.random()}@example.com`, username: `u${Math.random()}`.slice(0, 20).replace('.', ''),
  authProvider: 'local', birthdate: new Date('1990-01-01'), ...extra
});

const segnalazione = (extra) => Report.create({
  reporterId: new mongoose.Types.ObjectId(),
  targetType: 'character',
  targetId: new mongoose.Types.ObjectId(),
  reason: 'spam',
  ...extra
});

describe('Conservazione dei dati', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  beforeEach(async () => {
    await User.deleteMany({});
    await Report.deleteMany({});
  });

  describe('Token di recupero password', () => {
    it('cancella l impronta di un token scaduto', async () => {
      const u = await utente({ passwordResetTokenHash: 'abc123', passwordResetExpiresAt: oreFa(2) });

      expect(await purgeExpiredResetTokens()).toBe(1);

      const dopo = await User.findById(u._id).select('+passwordResetTokenHash +passwordResetExpiresAt');
      expect(dopo.passwordResetTokenHash).toBeNull();
      expect(dopo.passwordResetExpiresAt).toBeNull();
    });

    it('non tocca un token ancora valido', async () => {
      const u = await utente({ passwordResetTokenHash: 'valido', passwordResetExpiresAt: oreAvanti(1) });

      expect(await purgeExpiredResetTokens()).toBe(0);

      const dopo = await User.findById(u._id).select('+passwordResetTokenHash');
      expect(dopo.passwordResetTokenHash).toBe('valido');
    });

    /**
     * La ragione per cui questo non e' un indice TTL: un TTL cancella il
     * DOCUMENTO, cioe' l'account di chi ha chiesto di recuperare la password.
     */
    it('non cancella l account a cui il token apparteneva', async () => {
      const u = await utente({ passwordResetTokenHash: 'abc', passwordResetExpiresAt: oreFa(5) });

      await runRetentionSweep();

      expect(await User.findById(u._id)).not.toBeNull();
    });
  });

  describe('Segnalazioni', () => {
    it('elimina una segnalazione chiusa oltre il periodo dichiarato', async () => {
      const vecchia = new Date(Date.now() - REPORT_RETENTION_MS - 24 * 3600 * 1000);
      await segnalazione({ status: 'dismissed', createdAt: vecchia });

      expect(await purgeOldClosedReports()).toBe(1);
      expect(await Report.countDocuments({})).toBe(0);
    });

    /**
     * Il confine che conta: una segnalazione mai esaminata dopo due anni e' un
     * problema di moderazione, e farla sparire nasconderebbe proprio il caso
     * che nessuno ha mai guardato.
     */
    it('NON elimina una segnalazione ancora aperta, per quanto vecchia', async () => {
      const vecchia = new Date(Date.now() - REPORT_RETENTION_MS - 365 * 24 * 3600 * 1000);
      await segnalazione({ status: 'pending', createdAt: vecchia });

      expect(await purgeOldClosedReports()).toBe(0);
      expect(await Report.countDocuments({})).toBe(1);
    });

    it('non elimina una segnalazione chiusa ma recente', async () => {
      await segnalazione({ status: 'actioned', createdAt: giorniFa(30) });

      expect(await purgeOldClosedReports()).toBe(0);
      expect(await Report.countDocuments({})).toBe(1);
    });
  });

  describe('La passata completa', () => {
    it('riferisce quanto ha fatto', async () => {
      await utente({ passwordResetTokenHash: 'x', passwordResetExpiresAt: oreFa(3) });
      await segnalazione({
        status: 'reviewed',
        createdAt: new Date(Date.now() - REPORT_RETENTION_MS - 1000)
      });

      const esito = await runRetentionSweep();

      expect(esito).toMatchObject({ resetTokens: 1, reports: 1, errors: [] });
    });

    /**
     * La manutenzione non deve mai abbattere il processo: un errore di pulizia
     * e' disordine, un processo morto e' un'interruzione di servizio.
     */
    it('non solleva se una fase fallisce, e lo dice nel risultato', async () => {
      const originale = Report.deleteMany;
      Report.deleteMany = () => Promise.reject(new Error('database non disponibile'));

      const esito = await runRetentionSweep();

      Report.deleteMany = originale;
      expect(esito.errors).toContain('reports');
    });

    it('sotto test non installa alcun timer', () => {
      expect(scheduleRetention()).toBeNull();
    });
  });
});
