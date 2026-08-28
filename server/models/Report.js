const mongoose = require('mongoose');

/**
 * Segnalazioni: quelle inviate dagli utenti e quelle generate automaticamente
 * dalla moderazione (FASE D — S2-13).
 *
 * Prima i documenti si accumulavano senza deduplica e senza che nessuno li
 * leggesse: 50 segnalazioni identiche sullo stesso bersaglio producevano 50
 * righe indistinguibili e nessuna interfaccia per esaminarle.
 */
const reportSchema = new mongoose.Schema({
  reporterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // 'user' = inviata da una persona · 'automatic' = aperta dalla moderazione
  source: {
    type: String,
    enum: ['user', 'automatic'],
    default: 'user',
    index: true
  },
  targetType: {
    type: String,
    enum: ['character', 'message', 'user'],
    required: true
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  // Proprietario del contenuto segnalato: permette di raggiungere l'account
  // responsabile senza risalire la catena a mano durante la revisione.
  targetOwnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  reason: {
    type: String,
    enum: [
      // Motivi scelti da chi segnala
      'hate_speech', 'harassment', 'nsfw_unmarked', 'copyright', 'spam', 'other',
      // Categorie prodotte dalla moderazione automatica
      'sexual_minors', 'sexual_violence', 'violence_instructions',
      'self_harm_instructions', 'illegal_drugs', 'prompt_injection'
    ],
    required: true
  },
  severity: {
    type: String,
    enum: ['block', 'crisis', 'flag', 'user_report'],
    default: 'user_report'
  },
  description: {
    type: String,
    maxlength: 1000,
    trim: true,
    default: ''
  },
  // Frammento del contenuto che ha fatto scattare la regola. Serve a chi
  // esamina per decidere in pochi secondi; è troncato perché la segnalazione
  // non deve diventare una seconda copia della conversazione.
  evidence: {
    type: String,
    maxlength: 500,
    default: ''
  },
  // Quante volte lo stesso bersaglio ha prodotto la stessa violazione: una
  // riga che cresce invece di N righe uguali.
  occurrences: {
    type: Number,
    default: 1
  },
  status: {
    type: String,
    enum: ['pending', 'reviewed', 'actioned', 'dismissed'],
    default: 'pending',
    index: true
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  reviewedAt: {
    type: Date,
    default: null
  },
  resolutionNote: {
    type: String,
    maxlength: 1000,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ targetType: 1, targetId: 1, status: 1 });

/**
 * Deduplica: una persona può segnalare lo stesso bersaglio una volta sola.
 * L'indice è parziale perché le segnalazioni automatiche seguono una regola
 * diversa (una per bersaglio e categoria, con un contatore).
 */
reportSchema.index(
  { reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true, partialFilterExpression: { source: 'user' } }
);
reportSchema.index(
  { targetType: 1, targetId: 1, reason: 1, status: 1 },
  { partialFilterExpression: { source: 'automatic' } }
);

reportSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Report', reportSchema);
