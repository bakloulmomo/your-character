const mongoose = require('mongoose');

/**
 * Opinioni degli utenti della beta.
 *
 * Il canale esiste per una ragione precisa: durante una beta chiusa la domanda
 * a cui bisogna rispondere non e' «funziona?» ma «le persone tornerebbero, e
 * pagherebbero?». Nessun log risponde a quella domanda. Le persone si', se
 * hanno un posto dove dirlo che non sia un'email da cercare.
 *
 * Viene SEMPRE salvato in database, e l'invio per email e' un di piu': se il
 * servizio di posta non e' configurato o fallisce, l'opinione non va persa.
 * Un canale di feedback che perde i messaggi quando il mailer e' giu' e' un
 * canale che smette di funzionare proprio quando qualcosa non va.
 */
const feedbackSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  /**
   * · review      — un'opinione spontanea sull'app
   * · wants_more  — «ho finito i crediti e voglio continuare»: e' il segnale
   *                 piu' vicino a una disponibilita' a pagare che si possa
   *                 raccogliere senza chiedere una carta di credito
   * · bug         — qualcosa non funziona
   */
  type: {
    type: String,
    enum: ['review', 'wants_more', 'bug'],
    required: true,
    index: true
  },

  /** Voto da 1 a 5, facoltativo: non tutti hanno voglia di scrivere. */
  rating: {
    type: Number,
    min: 1,
    max: 5,
    default: null
  },

  message: {
    type: String,
    maxlength: 2000,
    default: ''
  },

  /**
   * Quanti messaggi aveva scritto quando ha lasciato l'opinione.
   * Un giudizio dopo due messaggi e uno dopo ottanta non pesano uguale, e
   * ricostruirlo dopo sarebbe impossibile.
   */
  messagesSent: {
    type: Number,
    default: 0
  },

  /** L'email e' stata recapitata a chi gestisce l'app? */
  notified: {
    type: Boolean,
    default: false
  },

  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

feedbackSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model('Feedback', feedbackSchema);
