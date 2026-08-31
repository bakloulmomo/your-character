const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true,
    index: true
  },
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true,
    maxlength: 4000
  },
  tokens: {
    input: { type: Number, default: 0 },
    output: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  },
  model: {
    type: String,
    default: 'gemini-2.5-flash'
  },
  image: {
    url: String,
    prompt: String,
    generationId: String,
  },
  cost: {
    type: Number,
    default: 0
  },
  // Explicit flag for AI-generation failures (so the client no longer has to
  // guess "is this an error?" by matching the message text).
  error: {
    type: Boolean,
    default: false
  },
  // Risposta prodotta in modalità degradata (nessuna chiave AI configurata):
  // è finta, va mostrata come tale e non viene mai addebitata.
  simulated: {
    type: Boolean,
    default: false
  },
  /**
   * Messaggio prodotto dalla piattaforma, non dal personaggio (FASE D — S2-1):
   * la risposta a una situazione di crisi o il rifiuto quando la moderazione
   * ferma l'output del modello. Non è un turno di finzione e il client lo
   * distingue visivamente invece di farlo passare per parole del personaggio.
   */
  safetyNotice: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true,
    index: true
  }
});

messageSchema.index({ chatId: 1, createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);
