/**
 * FASE D — IVA, importi in centesimi e ricevute (S2-12).
 *
 * Prima ogni transazione registrava un solo importo in euro come numero a
 * virgola mobile: nessun imponibile, nessuna aliquota, nessun paese, nessuna
 * ricevuta. Su vendite digitali B2C nell'Unione questo significa non poter né
 * dichiarare l'imposta né darne conto al cliente.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Counter = require('../models/Counter');
const { breakdown, rateFor, EU_VAT_RATES } = require('../services/vat');

let mongoServer;
let user;
let token;

const tokenFor = (u) =>
  jwt.sign({ id: u._id, email: u.email, username: u.username, tv: u.tokenVersion || 0 },
    process.env.JWT_SECRET, { expiresIn: '1h' });

const auth = (req) => req.set('Authorization', `Bearer ${token}`);

describe('FASE D — Fiscalità e ricevute', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Transaction.deleteMany({}), Counter.deleteMany({})]);
    user = await User.create({ email: 'cliente@example.com', username: 'cliente', credits: 0 });
    token = tokenFor(user);
  });

  // ---- Calcolo --------------------------------------------------------------
  describe('il calcolo dell\'imposta', () => {
    it('scompone un prezzo IVA inclusa senza perdere centesimi', () => {
      for (const country of Object.keys(EU_VAT_RATES)) {
        for (const gross of [299, 499, 1499, 4999]) {
          const b = breakdown(gross, country);
          expect(b.netCents + b.vatCents).toBe(gross);
          expect(Number.isInteger(b.netCents)).toBe(true);
          expect(Number.isInteger(b.vatCents)).toBe(true);
        }
      }
    });

    it('applica l\'aliquota del paese del CLIENTE, non del venditore', () => {
      expect(breakdown(1499, 'IT').vatRate).toBe(22);
      expect(breakdown(1499, 'DE').vatRate).toBe(19);
      expect(breakdown(1499, 'LU').vatRate).toBe(17);
      expect(breakdown(1499, 'HU').vatRate).toBe(27);
    });

    it('fuori dall\'Unione non applica IVA europea e lo dichiara', () => {
      const b = breakdown(1499, 'US');
      expect(b.vatCents).toBe(0);
      expect(b.netCents).toBe(1499);
      expect(b.euVat).toBe(false);
    });

    it('un paese sconosciuto non fa scattare un\'aliquota a caso', () => {
      expect(rateFor('ZZ')).toBe(0);
      expect(rateFor(null)).toBe(0);
    });
  });

  // ---- Registrazione --------------------------------------------------------
  describe('la transazione registra la scomposizione', () => {
    it('il checkout salva importi interi e la ripartizione dell\'imposta', async () => {
      const res = await auth(request(app).post('/api/payments/checkout'))
        .send({ packageId: 'premium', country: 'DE' });

      expect(res.status).toBe(200);

      const tx = await Transaction.findById(res.body.transactionId);
      expect(tx.grossCents).toBe(1499);
      expect(tx.vatRate).toBe(19);
      expect(tx.country).toBe('DE');
      expect(tx.netCents + tx.vatCents).toBe(tx.grossCents);
      // Nessun importo in virgola mobile sul registro del denaro.
      expect(Number.isInteger(tx.grossCents)).toBe(true);
    });

    it('in mancanza di una dichiarazione usa il paese salvato sul profilo', async () => {
      await User.findByIdAndUpdate(user._id, { billingCountry: 'ES' });

      const res = await auth(request(app).post('/api/payments/checkout')).send({ packageId: 'starter' });
      const tx = await Transaction.findById(res.body.transactionId);
      expect(tx.country).toBe('ES');
      expect(tx.vatRate).toBe(21);
    });

    it('l\'anteprima mostra imponibile e imposta prima del pagamento', async () => {
      const res = await auth(request(app).get('/api/payments/vat-preview?packageId=popular&country=FR'));
      expect(res.status).toBe(200);
      expect(res.body.grossCents).toBe(499);
      expect(res.body.vatRate).toBe(20);
    });
  });

  // ---- Ricevute -------------------------------------------------------------
  describe('la ricevuta', () => {
    const completeCheckout = async (packageId = 'starter', country = 'IT') => {
      const checkout = await auth(request(app).post('/api/payments/checkout'))
        .send({ packageId, country });
      const confirm = await auth(request(app).post('/api/payments/confirm'))
        .send({ transactionId: checkout.body.transactionId });
      return { transactionId: checkout.body.transactionId, confirm };
    };

    it('viene emessa con un numero progressivo solo a pagamento riuscito', async () => {
      const { transactionId, confirm } = await completeCheckout();

      expect(confirm.status).toBe(200);
      expect(confirm.body.invoiceNumber).toMatch(/^YC-\d{4}-\d{6}$/);

      const receipt = await auth(request(app).get(`/api/payments/receipt/${transactionId}`));
      expect(receipt.status).toBe(200);
      expect(receipt.body.invoiceNumber).toBe(confirm.body.invoiceNumber);
      expect(receipt.body.amounts.grossCents).toBe(299);
      expect(receipt.body.amounts.vatRate).toBe(22);
      expect(receipt.body.vatNote).toContain('OSS');
    });

    it('i numeri sono progressivi e mai ripetuti, anche su pagamenti simultanei', async () => {
      const checkouts = await Promise.all(
        ['starter', 'popular', 'premium', 'starter', 'popular'].map((packageId) =>
          auth(request(app).post('/api/payments/checkout')).send({ packageId })
        )
      );

      const confirms = await Promise.all(
        checkouts.map((c) =>
          auth(request(app).post('/api/payments/confirm')).send({ transactionId: c.body.transactionId })
        )
      );

      const numbers = confirms.map((c) => c.body.invoiceNumber);
      expect(new Set(numbers).size).toBe(5);
      const sequence = numbers.map((n) => parseInt(n.split('-')[2], 10)).sort((a, b) => a - b);
      expect(sequence).toEqual([1, 2, 3, 4, 5]);
    });

    it('non è disponibile finché il pagamento è in sospeso', async () => {
      const checkout = await auth(request(app).post('/api/payments/checkout')).send({ packageId: 'starter' });
      const res = await auth(request(app).get(`/api/payments/receipt/${checkout.body.transactionId}`));
      expect(res.status).toBe(409);
    });

    it('non si può leggere la ricevuta di un altro utente', async () => {
      const { transactionId } = await completeCheckout();

      const stranger = await User.create({ email: 'estraneo@example.com', username: 'estraneo' });
      const res = await request(app)
        .get(`/api/payments/receipt/${transactionId}`)
        .set('Authorization', `Bearer ${tokenFor(stranger)}`);

      expect(res.status).toBe(404);
    });

    it('si dichiara provvisoria finché i dati fiscali del venditore non sono configurati', async () => {
      const { transactionId } = await completeCheckout();
      const res = await auth(request(app).get(`/api/payments/receipt/${transactionId}`));

      // Meglio una ricevuta che ammette di essere incompleta di una che esibisce
      // un'intestazione inventata.
      expect(res.body.sellerConfigured).toBe(false);
      expect(res.body.provisional).toBe(true);
    });

    it('con i dati del venditore configurati non è più provvisoria', async () => {
      process.env.SELLER_NAME = 'your-character S.r.l.';
      process.env.SELLER_VAT_NUMBER = 'IT01234567890';
      process.env.SELLER_ADDRESS = 'Via Esempio 1, Milano';
      try {
        const { transactionId } = await completeCheckout();
        const res = await auth(request(app).get(`/api/payments/receipt/${transactionId}`));
        expect(res.body.provisional).toBe(false);
        expect(res.body.seller.vatNumber).toBe('IT01234567890');
      } finally {
        delete process.env.SELLER_NAME;
        delete process.env.SELLER_VAT_NUMBER;
        delete process.env.SELLER_ADDRESS;
      }
    });

    it('lo storico dei pagamenti è consultabile dall\'utente', async () => {
      await completeCheckout('starter');
      await completeCheckout('premium');

      const res = await auth(request(app).get('/api/payments/transactions'));
      expect(res.status).toBe(200);
      expect(res.body.transactions).toHaveLength(2);
      expect(res.body.transactions[0]).toHaveProperty('invoiceNumber');
      expect(res.body.transactions[0]).toHaveProperty('vatCents');
    });
  });
});
