const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { mockPaymentsEnabled, isProduction } = require('../config/env');
const { checkoutLimiter } = require('../middleware/rateLimit');
const { requireFeature } = require('../middleware/featureGate');
const crypto = require('crypto');
const { breakdown, isEuCountry, rateFor, RATES_REVIEWED_ON } = require('../services/vat');
const { nextSequence } = require('../models/Counter');
const { sellerDetails } = require('../config/env');
const { serverFailure, warnFailure } = require('../services/failure');
const logger = require('../services/logger');

// Credit packages - minimum €2.99 to avoid Stripe fixed fee trap
const CREDIT_PACKAGES = {
  starter: {
    credits: 50,
    amount: 299,  // €2.99 in cents
    currency: 'eur',
    name: '50 Crediti - Starter Pack',
    priceId: 'price_starter'
  },
  popular: {
    credits: 150,
    amount: 499,  // €4.99 in cents
    currency: 'eur',
    name: '150 Crediti - Popular Pack',
    priceId: 'price_popular'
  },
  premium: {
    credits: 600,
    amount: 1499, // €14.99 in cents
    currency: 'eur',
    name: '600 Crediti - Premium Pack',
    priceId: 'price_premium'
  }
};

// Subscription plans. `days` drives the mock expiry window; in production the
// billing period is governed by the Stripe Price (STRIPE_PRICE_MONTHLY / _ANNUAL).
const SUBSCRIPTION_PLANS = {
  monthly: { amount: 499, interval: 'month', days: 30, name: 'Abbonamento Mensile' },
  annual: { amount: 4999, interval: 'year', days: 365, name: 'Abbonamento Annuale' }
};

// I pagamenti simulati esistono SOLO fuori produzione (vedi config/env.js).
// In produzione questa funzione restituisce sempre false, quindi nessuna delle
// scorciatoie sottostanti è raggiungibile.
const isMockStripe = () => mockPaymentsEnabled();

// Numero massimo di crediti accreditabili da un singolo evento: nessun
// pacchetto vale di più, quindi un valore superiore è un dato manomesso.
/**
 * Ricerca in una tabella letterale, senza ereditare da `Object.prototype` (S12).
 *
 * `CREDIT_PACKAGES[packageId]` con `packageId === '__proto__'` restituisce
 * `Object.prototype`, che è truthy: il controllo `if (!pkg) return 400` non
 * scattava, e a valle `pkg.amount` e `pkg.credits` erano `undefined` fino a far
 * fallire la creazione della transazione con un 500. Stesso effetto con
 * `'constructor'`, e su `SUBSCRIPTION_PLANS` produceva `new Date(NaN)` e un
 * `CastError`. Nessun accredito indebito — solo 500 gratuiti su rotte
 * autenticate — ma è un difetto che si chiude in una riga.
 *
 * Il modo corretto era già usato in `services/vat.js`: qui era rimasto fuori.
 */
const cerca = (tabella, chiave) =>
  (typeof chiave === 'string' && Object.prototype.hasOwnProperty.call(tabella, chiave))
    ? tabella[chiave]
    : null;

const MAX_GRANTABLE_CREDITS = Math.max(...Object.values(CREDIT_PACKAGES).map((p) => p.credits));

/**
 * Paese del consumatore ai fini IVA (FASE D — S2-12).
 *
 * Ordine: quello dichiarato nella richiesta, poi quello salvato sul profilo,
 * infine il paese del venditore. Una nota di onestà: la normativa UE chiede
 * DUE elementi di prova non contraddittori (es. paese di emissione della carta
 * e indirizzo IP) per stabilire il luogo di consumo. Qui si registra ciò che
 * si sa davvero — la dichiarazione del cliente — e lo si scrive sulla
 * transazione, così la ricevuta dice il vero e la riconciliazione con i dati
 * Stripe resta possibile. Fingere una prova che non abbiamo sarebbe peggio.
 */
const resolveCountry = (user, declared) => {
  const candidate = String(declared || '').toUpperCase();
  if (/^[A-Z]{2}$/.test(candidate)) return candidate;
  if (user && user.billingCountry) return user.billingCountry;
  return sellerDetails().country;
};

/**
 * Numero progressivo di ricevuta, assegnato una sola volta per transazione e
 * solo a pagamento riuscito. La sequenza è per anno.
 */
/**
 * Istantanea dell'identita' del cliente, scritta sulla transazione al momento
 * del pagamento. Rende la ricevuta un documento indipendente dall'account.
 */
const snapshotOf = (user, country) => ({
  username: user.username || null,
  email: user.email || null,
  country: country || null
});

async function assignInvoiceNumber(transaction) {
  if (!transaction || transaction.invoiceNumber) return transaction;
  const year = new Date().getFullYear();
  const seq = await nextSequence(`invoice:${year}`);
  const invoiceNumber = `YC-${year}-${String(seq).padStart(6, '0')}`;
  return Transaction.findByIdAndUpdate(transaction._id, { invoiceNumber }, { new: true });
}

// GET /api/payments/packages - Returns available credit packages
router.get('/packages', requireFeature('payments'), (req, res) => {
  res.json(CREDIT_PACKAGES);
});

// GET /api/payments/plans - Returns available subscription plans
router.get('/plans', requireFeature('subscriptions'), (req, res) => {
  res.json(SUBSCRIPTION_PLANS);
});

// POST /api/payments/checkout - Create Stripe PaymentIntent for a credit pack
router.post('/checkout', requireFeature('payments'), requireAuth, checkoutLimiter, async (req, res) => {
  try {
    const { packageId } = req.body;

    const pkg = cerca(CREDIT_PACKAGES, packageId);
    if (!pkg) {
      return res.status(400).json({ error: 'Pacchetto di crediti non valido' });
    }

    const userId = req.user._id.toString();

    // Idempotenza PER TENTATIVO, non per giorno.
    // La chiave precedente conteneva solo la data: il secondo acquisto dello
    // stesso pacchetto nello stesso giorno violava l'indice unique e produceva
    // un 500, impedendo un riacquisto perfettamente legittimo (S1-6).
    const idempotencyKey = `checkout_${userId}_${packageId}_${crypto.randomUUID()}`;

    // I prezzi di listino sono IVA inclusa: l'imponibile e l'imposta si
    // ricavano dal lordo in base al paese del cliente.
    const country = resolveCountry(req.user, req.body.country);
    const vat = breakdown(pkg.amount, country);

    // Sessione simulata: solo in sviluppo/test, mai in produzione.
    if (isMockStripe()) {
      const pendingTransaction = await Transaction.create({
        userId: req.user._id,
        type: 'purchase',
        credits: pkg.credits,
        grossCents: vat.grossCents,
        netCents: vat.netCents,
        vatCents: vat.vatCents,
        vatRate: vat.vatRate,
        country: vat.country,
        currency: pkg.currency,
        customerSnapshot: snapshotOf(req.user, vat.country),
        stripePaymentIntentId: `pi_mock_${Date.now()}`,
        status: 'pending',
        idempotencyKey
      });

      return res.json({
        clientSecret: `pi_mock_secret_${Date.now()}`,
        transactionId: pendingTransaction._id,
        package: pkg,
        mode: 'mock'
      });
    }

    // Create real Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: pkg.amount,
        currency: pkg.currency,
        metadata: {
          userId,
          packageId,
          credits: pkg.credits.toString(),
          country: vat.country
        },
        automatic_payment_methods: { enabled: true }
      },
      { idempotencyKey }
    );

    // Create pending transaction record
    const transaction = await Transaction.create({
      userId: req.user._id,
      type: 'purchase',
      credits: pkg.credits,
      grossCents: vat.grossCents,
      netCents: vat.netCents,
      vatCents: vat.vatCents,
      vatRate: vat.vatRate,
      country: vat.country,
      currency: pkg.currency,
      customerSnapshot: snapshotOf(req.user, vat.country),
      stripePaymentIntentId: paymentIntent.id,
      status: 'pending',
      idempotencyKey
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      transactionId: transaction._id,
      package: pkg,
      vat: { rate: vat.vatRate, country: vat.country, netCents: vat.netCents, vatCents: vat.vatCents }
    });
  } catch (error) {
    serverFailure(req, res, error, 'Impossibile creare la sessione di pagamento');
  }
});

// POST /api/payments/webhook - Stripe Webhook (HMAC signature verified)
// Note: Must use raw body - mounted before express.json() in server.js
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  // La firma è SEMPRE obbligatoria. Non esiste alcun ramo che accetti un corpo
  // non firmato: senza questa regola chiunque poteva inviare un evento
  // "pagamento riuscito" con i crediti che voleva.
  if (!webhookSecret) {
    warnFailure(req, new Error('STRIPE_WEBHOOK_SECRET non configurato'), 'Webhook rifiutato: firma non verificabile');
    return res.status(400).json({ error: 'Webhook non configurato' });
  }
  if (!sig || !Buffer.isBuffer(req.body)) {
    return res.status(400).json({ error: 'Firma o corpo grezzo mancanti' });
  }

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    warnFailure(req, err, 'Webhook rifiutato: firma non valida');
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Handle payment_intent.succeeded event
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const { userId, credits } = paymentIntent.metadata || {};

    if (!userId || !credits) {
      return res.status(200).json({ received: true });
    }

    // I metadati arrivano dall'esterno: un valore non numerico o fuori scala
    // non viene accreditato (prima `parseInt` poteva produrre NaN e corrompere
    // il saldo, oppure accreditare qualsiasi cifra).
    const amount = Number.parseInt(credits, 10);
    if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_GRANTABLE_CREDITS) {
      warnFailure(req, new Error(`Crediti non plausibili (${credits}) per ${paymentIntent.id}`), 'Webhook ignorato: crediti fuori scala');
      return res.status(200).json({ received: true, ignored: 'credits_non_validi' });
    }

    try {
      // Rivendicazione ATOMICA della transazione prima di accreditare:
      // due retry concorrenti di Stripe non possono accreditare due volte.
      const claimed = await Transaction.findOneAndUpdate(
        { stripePaymentIntentId: paymentIntent.id, status: { $ne: 'completed' } },
        { status: 'completed', completedAt: new Date() },
        { new: true }
      );

      if (!claimed) {
        return res.status(200).json({ received: true, duplicate: true });
      }

      /**
       * Si accredita ciò che dice la TRANSAZIONE, non i metadati (S4).
       *
       * Era `User.findByIdAndUpdate(userId, { $inc: { credits: amount } })`,
       * con `userId` e `amount` presi dai metadati dell'evento — cioè da un
       * payload esterno — mentre `claimed` era già lì: il record scritto dal
       * server al momento del checkout, a partire dalla tabella dei pacchetti
       * che sta in questo file. La transazione veniva rivendicata in modo
       * atomico (l'idempotenza era corretta) e poi ignorata.
       *
       * Non è sfruttabile da un client anonimo: serve una firma Stripe valida.
       * Ma è esattamente la difesa in profondità che il resto del file applica
       * ovunque, e il record autorevole esisteva già. Un evento con
       * `metadata.credits = "600"` su un pacchetto da 50 accreditava 600.
       *
       * I metadati restano, come CONTROLLO: se divergono, l'accredito segue il
       * record e la divergenza finisce nel log, dove qualcuno può vederla.
       */
      if (claimed.credits !== amount || String(claimed.userId) !== String(userId)) {
        warnFailure(
          req,
          new Error(
            `Metadati discordi su ${paymentIntent.id}: ` +
            `metadata=${userId}/${amount} transazione=${claimed.userId}/${claimed.credits}`
          ),
          'Accreditato secondo la transazione, non secondo i metadati'
        );
      }

      await User.findByIdAndUpdate(claimed.userId, { $inc: { credits: claimed.credits } });
      await assignInvoiceNumber(claimed);

      // Accredito riuscito: va nel log strutturato, con il requestId, perché è
      // la riga che si cerca quando qualcuno scrive «ho pagato e non vedo nulla».
      (req.log || logger).info(
        { credits: claimed.credits, userId: claimed.userId, paymentIntentId: paymentIntent.id },
        'Crediti accreditati dal webhook Stripe'
      );
      return res.status(200).json({ received: true });
    } catch (err) {
      // 5xx, non 200: un errore interno deve far ritentare Stripe, altrimenti
      // il cliente ha pagato e i crediti non arrivano mai.
      return serverFailure(req, res, err, 'Elaborazione fallita, ritentare');
    }
  }

  // Handle payment_intent.payment_failed
  if (event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object;
    await Transaction.findOneAndUpdate(
      { stripePaymentIntentId: paymentIntent.id },
      { status: 'failed' }
    );
    return res.status(200).json({ received: true });
  }

  // Handle subscription activation from a real Stripe Checkout Session
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const { userId, plan } = s.metadata || {};
    const cfg = cerca(SUBSCRIPTION_PLANS, plan);
    // Una sessione completata non è necessariamente pagata (es. pagamenti
    // differiti): attivare l'abbonamento senza questo controllo regalerebbe
    // l'accesso a chi non ha ancora pagato.
    const isPaid = s.payment_status === 'paid' || s.payment_status === undefined;
    if (userId && cfg && isPaid) {
      const now = new Date();
      await User.findByIdAndUpdate(userId, {
        subscription: plan,
        subscriptionExpiresAt: new Date(now.getTime() + cfg.days * 24 * 60 * 60 * 1000),
        stripeCustomerId: s.customer || null,
        dailyMessageCount: 0,
        dailyImageCount: 0,
        lastResetDate: now
      }, {
        /**
         * `runValidators`, e non è pignoleria (S3).
         *
         * `findByIdAndUpdate` in Mongoose NON esegue i validator dello schema
         * se non glielo si chiede: l'`enum` su `subscription` c'era, e su
         * questa riga non valeva nulla. `plan` arriva dai metadati di un evento
         * esterno. Prima `reserveAllowance` rispondeva a un piano sconosciuto
         * concedendo chiamate al modello illimitate e gratuite; ora nega, ma la
         * scrittura sbagliata non deve avvenire comunque — le due difese
         * servono a cose diverse.
         */
        runValidators: true
      });
    }
    return res.status(200).json({ received: true });
  }

  // Rinnovo riuscito: estende il periodo pagato.
  // Senza questo handler `subscriptionExpiresAt` non veniva mai aggiornato e
  // dopo 30 giorni un abbonato che continuava a pagare veniva declassato a
  // gratuito (S1-9).
  if (event.type === 'invoice.paid' || event.type === 'customer.subscription.updated') {
    const object = event.data.object;
    const customerId = object.customer;
    const periodEnd = object.current_period_end || (object.lines && object.lines.data[0] && object.lines.data[0].period && object.lines.data[0].period.end);

    if (customerId && periodEnd) {
      const now = new Date();
      await User.findOneAndUpdate(
        { stripeCustomerId: customerId },
        {
          subscriptionExpiresAt: new Date(periodEnd * 1000),
          dailyMessageCount: 0,
          dailyImageCount: 0,
          lastResetDate: now
        }
      );
    }
    return res.status(200).json({ received: true });
  }

  // Pagamento fallito: non si revoca subito l'accesso (Stripe ritenta per
  // giorni), ma si registra l'insolvenza per non perdere traccia.
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    if (invoice.customer) {
      await Transaction.create({
        userId: (await User.findOne({ stripeCustomerId: invoice.customer }))?._id,
        type: 'subscription',
        credits: 0,
        grossCents: Math.round(invoice.amount_due || 0),
        currency: invoice.currency || 'eur',
        status: 'failed'
      }).catch(() => {});
    }
    return res.status(200).json({ received: true });
  }

  // Subscription ended/cancelled at Stripe → revert user to free
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    if (sub.customer) {
      await User.findOneAndUpdate(
        { stripeCustomerId: sub.customer },
        { subscription: 'free', subscriptionExpiresAt: null },
        { runValidators: true }
      );
    }
    return res.status(200).json({ received: true });
  }

  return res.status(200).json({ received: true });
});

// POST /api/payments/confirm - Settle a MOCK checkout and grant credits SERVER-SIDE.
// In production, real PaymentIntents are completed by the Stripe webhook; this route
// only settles mock transactions (id starting with 'pi_mock_'). The client must call
// this and read the balance from the response instead of granting credits locally.
router.post('/confirm', requireFeature('payments'), requireAuth, async (req, res) => {
  try {
    // In produzione questa rotta non esiste: i pagamenti veri si concludono
    // esclusivamente con il webhook firmato di Stripe. Lasciarla raggiungibile
    // significava poter accreditare crediti senza pagare nulla.
    if (isProduction() || !isMockStripe()) {
      return res.status(404).json({ error: 'Rotta non disponibile' });
    }

    const { transactionId } = req.body;
    if (!transactionId || !/^[0-9a-fA-F]{24}$/.test(transactionId)) {
      return res.status(400).json({ error: 'transactionId non valido' });
    }

    const tx = await Transaction.findOne({ _id: transactionId, userId: req.user._id });
    if (!tx) {
      return res.status(404).json({ error: 'Transazione non trovata' });
    }

    // Real Stripe payments must be confirmed via webhook, never here.
    if (!tx.stripePaymentIntentId || !tx.stripePaymentIntentId.startsWith('pi_mock_')) {
      return res.status(400).json({ error: 'Questa transazione va completata tramite Stripe' });
    }

    if (tx.status === 'completed') {
      const current = await User.findById(req.user._id).select('credits subscription');
      return res.json({ success: true, alreadyCompleted: true, credits: current.credits, subscription: current.subscription });
    }

    // Atomically claim the pending transaction to prevent a double credit grant.
    const claimed = await Transaction.findOneAndUpdate(
      { _id: transactionId, status: 'pending' },
      { status: 'completed', completedAt: new Date() },
      { new: true }
    );

    if (!claimed) {
      // Another request settled it first — return current balance without granting again.
      const current = await User.findById(req.user._id).select('credits subscription');
      return res.json({ success: true, alreadyCompleted: true, credits: current.credits, subscription: current.subscription });
    }

    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { $inc: { credits: claimed.credits } },
      { new: true }
    );

    const receipted = await assignInvoiceNumber(claimed);

    return res.json({
      success: true,
      credits: updated.credits,
      subscription: updated.subscription,
      invoiceNumber: receipted.invoiceNumber
    });
  } catch (error) {
    return serverFailure(req, res, error, 'Impossibile confermare il pagamento');
  }
});

// POST /api/payments/subscribe - Activate a monthly/annual subscription.
// Mock mode activates immediately; real Stripe returns a Checkout Session URL and
// activation happens on the checkout.session.completed webhook.
router.post('/subscribe', requireFeature('subscriptions'), requireAuth, async (req, res) => {
  try {
    const { plan } = req.body;
    const cfg = cerca(SUBSCRIPTION_PLANS, plan);
    if (!cfg) {
      return res.status(400).json({ error: 'Piano di abbonamento non valido' });
    }

    if (isMockStripe()) {
      const now = new Date();
      const expires = new Date(now.getTime() + cfg.days * 24 * 60 * 60 * 1000);
      const updated = await User.findByIdAndUpdate(
        req.user._id,
        {
          subscription: plan,
          subscriptionExpiresAt: expires,
          dailyMessageCount: 0,
          dailyImageCount: 0,
          lastResetDate: now
        },
        { new: true, runValidators: true }
      );

      const subVat = breakdown(cfg.amount, resolveCountry(req.user, req.body.country));
      const subscriptionTx = await Transaction.create({
        userId: req.user._id,
        type: 'subscription',
        credits: 0,
        grossCents: subVat.grossCents,
        netCents: subVat.netCents,
        vatCents: subVat.vatCents,
        vatRate: subVat.vatRate,
        country: subVat.country,
        currency: 'eur',
        customerSnapshot: snapshotOf(req.user, subVat.country),
        status: 'completed',
        completedAt: now
      });
      await assignInvoiceNumber(subscriptionTx);

      return res.json({
        success: true,
        mode: 'mock',
        subscription: updated.subscription,
        subscriptionExpiresAt: updated.subscriptionExpiresAt
      });
    }

    // Real Stripe: requires configured recurring Price IDs.
    const priceId = process.env[`STRIPE_PRICE_${plan.toUpperCase()}`];
    if (!priceId) {
      return res.status(500).json({ error: 'Prezzo abbonamento non configurato' });
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: req.user.email,
      metadata: { userId: req.user._id.toString(), plan },
      success_url: `${process.env.FRONTEND_URL}/?subscription=success`,
      cancel_url: `${process.env.FRONTEND_URL}/?subscription=cancel`
    });

    return res.json({ url: checkoutSession.url });
  } catch (error) {
    return serverFailure(req, res, error, 'Impossibile attivare l\'abbonamento');
  }
});

// POST /api/payments/cancel-subscription - Disdetta a fine periodo.
//
// Prima questa rotta portava subito il piano a `free` — l'utente perdeva il
// periodo già pagato — e non chiamava mai Stripe, quindi l'addebito ricorrente
// continuava: il peggiore dei due mondi (S1-8).
router.post('/cancel-subscription', requireFeature('subscriptions'), requireAuth, async (req, res) => {
  try {
    const user = req.user;

    if (user.subscription === 'free') {
      return res.status(400).json({ error: 'Non hai un abbonamento attivo.' });
    }

    // Con Stripe reale: disdetta programmata a fine periodo. L'accesso resta
    // attivo fino a `subscriptionExpiresAt`, poi `applySubscriptionExpiry`
    // riporta il piano a gratuito.
    if (!isMockStripe() && user.stripeCustomerId) {
      const subs = await stripe.subscriptions.list({
        customer: user.stripeCustomerId,
        status: 'active',
        limit: 1
      });

      if (subs.data.length > 0) {
        await stripe.subscriptions.update(subs.data[0].id, { cancel_at_period_end: true });
        return res.json({
          success: true,
          subscription: user.subscription,
          cancelAtPeriodEnd: true,
          activeUntil: user.subscriptionExpiresAt,
          message: 'Abbonamento disdetto. Resta attivo fino alla fine del periodo già pagato.'
        });
      }
    }

    // Modalità simulata: nessun abbonamento remoto da disdire, ma il periodo
    // già "pagato" viene comunque rispettato.
    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { subscriptionCancelAtPeriodEnd: true },
      { new: true }
    );

    return res.json({
      success: true,
      subscription: updated.subscription,
      cancelAtPeriodEnd: true,
      activeUntil: updated.subscriptionExpiresAt,
      message: 'Abbonamento disdetto. Resta attivo fino alla fine del periodo già pagato.'
    });
  } catch (error) {
    return serverFailure(req, res, error, 'Impossibile annullare l\'abbonamento');
  }
});

/**
 * GET /api/payments/transactions - Storico dei propri pagamenti.
 * Prima non esisteva alcuna rotta per rileggerli: l'utente non aveva modo di
 * sapere che cosa avesse pagato, e quando.
 */
router.get('/transactions', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);

    const transactions = await Transaction.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('type credits grossCents netCents vatCents vatRate country currency status invoiceNumber createdAt completedAt')
      .lean();

    res.json({ transactions });
  } catch (error) {
    serverFailure(req, res, error, 'Impossibile recuperare lo storico dei pagamenti');
  }
});

/**
 * GET /api/payments/receipt/:transactionId - Ricevuta di un pagamento (S2-12).
 *
 * Contiene ciò che una ricevuta deve contenere: numero progressivo, data,
 * venditore, imponibile, aliquota, imposta, totale e paese di consumo.
 *
 * `sellerConfigured` dice la verità sullo stato dell'intestazione: finché i
 * dati fiscali del venditore non sono configurati, la ricevuta si dichiara
 * provvisoria invece di esibire un'intestazione inventata.
 */
router.get('/receipt/:transactionId', requireAuth, async (req, res) => {
  try {
    if (!/^[0-9a-fA-F]{24}$/.test(req.params.transactionId)) {
      return res.status(400).json({ error: 'ID transazione non valido' });
    }

    const tx = await Transaction.findOne({ _id: req.params.transactionId, userId: req.user._id }).lean();
    if (!tx) return res.status(404).json({ error: 'Transazione non trovata' });

    if (tx.status !== 'completed') {
      return res.status(409).json({ error: 'La ricevuta è disponibile solo per i pagamenti completati.' });
    }

    const seller = sellerDetails();

    res.json({
      invoiceNumber: tx.invoiceNumber,
      issuedAt: tx.completedAt || tx.createdAt,
      seller: {
        name: seller.name,
        vatNumber: seller.vatNumber,
        address: seller.address,
        country: seller.country,
        ossRegistered: seller.ossRegistered
      },
      sellerConfigured: seller.configured,
      provisional: !seller.configured,
      // Dall'istantanea salvata al pagamento, non dall'account di oggi: una
      // ricevuta deve riportare i dati validi quando e' stata emessa, e deve
      // restare emettibile anche se l'account nel frattempo non esiste piu'.
      customer: {
        username: tx.customerSnapshot?.username ?? req.user.username,
        email: tx.customerSnapshot?.email ?? req.user.email,
        country: tx.customerSnapshot?.country ?? tx.country
      },
      line: {
        description: tx.type === 'subscription' ? 'Abbonamento your-character' : `Ricarica di ${tx.credits} crediti`,
        credits: tx.credits
      },
      amounts: {
        currency: (tx.currency || 'eur').toUpperCase(),
        netCents: tx.netCents,
        vatCents: tx.vatCents,
        grossCents: tx.grossCents,
        vatRate: tx.vatRate
      },
      vatNote: isEuCountry(tx.country)
        ? `IVA ${tx.vatRate}% assolta nel paese del consumatore (${tx.country}) tramite regime OSS.`
        : 'Operazione fuori dal campo di applicazione dell\'IVA UE: nessuna imposta europea applicata.',
      ratesReviewedOn: RATES_REVIEWED_ON
    });
  } catch (error) {
    serverFailure(req, res, error, 'Impossibile generare la ricevuta');
  }
});

/**
 * GET /api/payments/vat-preview?country=IT&packageId=premium
 * Serve all'interfaccia per mostrare imponibile e imposta PRIMA del pagamento,
 * invece di far comparire un totale senza spiegazione.
 */
router.get('/vat-preview', requireFeature('payments'), requireAuth, async (req, res) => {
  const { packageId, plan } = req.query;
  const source = cerca(CREDIT_PACKAGES, packageId) || cerca(SUBSCRIPTION_PLANS, plan);
  if (!source) return res.status(400).json({ error: 'Pacchetto o piano non valido' });

  const country = resolveCountry(req.user, req.query.country);
  res.json({ ...breakdown(source.amount, country), rateAvailable: rateFor(country) });
});

module.exports = router;
