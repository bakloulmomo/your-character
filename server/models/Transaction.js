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

/** Importo in euro, per la sola visualizzazione. La verità resta in centesimi. */
transactionSchema.virtual('amountEur').get(function() {
  return (this.grossCents || 0) / 100;
});

transactionSchema.set('toJSON', { virtuals: true });
transactionSchema.set('toObject', { virtuals: true });

transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ status: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
