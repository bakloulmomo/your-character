const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['purchase', 'subscription', 'refund', 'bonus', 'image_generation'],
    required: true
  },
  credits: {
    type: Number,
    required: true
  },

  /**
   * Importi in CENTESIMI INTERI (FASE D — S2-12).
   *
   * Prima esisteva un solo campo `amount` in euro come numero a virgola
   * mobile: nessun imponibile, nessuna imposta, nessun paese — cioè nessun
   * modo di dichiarare l'IVA né di emettere una ricevuta — e per giunta su un
   * tipo che non rappresenta esattamente i decimali del denaro.
   */
  grossCents: {
    type: Number,
    required: true,
    min: 0
  },
  netCents: {
    type: Number,
    default: 0,
    min: 0
  },
  vatCents: {
    type: Number,
    default: 0,
    min: 0
  },
  vatRate: {
    type: Number,
    default: 0
  },
  // Paese del consumatore: determina l'aliquota nel regime OSS.
  country: {
    type: String,
    uppercase: true,
    default: null
  },
  currency: {
    type: String,
    default: 'EUR'
  },

  /**
   * Numero progressivo della ricevuta, assegnato SOLO quando il pagamento è
   * andato a buon fine: una sequenza che si incrementa anche sui tentativi
   * falliti avrebbe buchi da giustificare.
   */
  invoiceNumber: {
    type: String,
    default: null,
    index: true
  },
  // L'indice sta in fondo al file: è UNIVOCO ma PARZIALE, e la ragione merita
  // più spazio di quanto ne stia in una riga di schema.
  stripePaymentIntentId: {
    type: String,
    default: null
  },
  stripeSubscriptionId: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  idempotencyKey: {
    type: String,
    unique: true,
    sparse: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true
  },
  completedAt: {
    type: Date,
    default: null
  }
});

/**
 * Identita' del cliente al momento del pagamento (istantanea).
 *
 * Una ricevuta deve bastare a se stessa. Prima i dati del cliente venivano
 * letti dall'account al momento di generarla: cancellato l'account, la
 * ricevuta non era piu' producibile — e infatti la cancellazione eliminava
 * anche le transazioni, distruggendo registri che l'art. 2220 c.c. obbliga a
 * conservare dieci anni e bucando la numerazione progressiva gia' emessa.
 *
 * Con l'istantanea la transazione e' un documento fiscale completo e
 * indipendente: sopravvive alla cancellazione dell'account, come deve, e il
 * GDPR lo consente esplicitamente quando esiste un obbligo di legge
 * (art. 17.3.b). E' anche piu' corretto nel merito: una ricevuta deve riportare
 * i dati validi QUANDO e' stata emessa, non quelli di oggi.
 */
transactionSchema.add({
  customerSnapshot: {
    username: { type: String, default: null },
    email: { type: String, default: null },
    country: { type: String, default: null }
  },
  /** L'account collegato e' stato cancellato: la riga resta per obbligo fiscale. */
  accountDeletedAt: { type: Date, default: null }
});

/** Importo in euro, per la sola visualizzazione. La verità resta in centesimi. */
transactionSchema.virtual('amountEur').get(function() {
  return (this.grossCents || 0) / 100;
});

transactionSchema.set('toJSON', { virtuals: true });
transactionSchema.set('toObject', { virtuals: true });

transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ status: 1 });

/**
 * Indice UNIVOCO e PARZIALE su `stripePaymentIntentId` (S10).
 *
 * Il campo era senza indice, ed è il filtro della rivendicazione atomica nel
 * webhook — il percorso critico del denaro. Ogni evento faceva una scansione
 * completa della collezione; Stripe ritenta per tre giorni con backoff, quindi
 * una raffica di retry durante un incidente moltiplicava le scansioni proprio
 * mentre il database era già in difficoltà, e i crediti dei clienti paganti non
 * arrivavano.
 *
 * `unique` sposta l'idempotenza dal codice al DATABASE, che è l'unico posto in
 * cui due processi concorrenti non possono aggirarla.
 *
 * PARZIALE e non `sparse`, e la differenza qui è sostanziale: `sparse` esclude
 * i documenti in cui il campo è ASSENTE, non quelli in cui vale `null`. Il
 * campo ha `default: null`, quindi ogni transazione simulata lo scrive
 * esplicitamente — con `sparse: true` la seconda transazione senza
 * PaymentIntent violava l'unicità contro la prima, ed è precisamente quello che
 * ha fatto fallire `fiscalRetention.test.js`. Il filtro sul tipo `string`
 * lascia fuori tutti i `null`, che è ciò che si intendeva.
 */
transactionSchema.index(
  { stripePaymentIntentId: 1 },
  { unique: true, partialFilterExpression: { stripePaymentIntentId: { $type: 'string' } } }
);

module.exports = mongoose.model('Transaction', transactionSchema);
