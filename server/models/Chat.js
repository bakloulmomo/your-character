const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  characterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Character',
    required: true,
    index: true
  },
  title: {
    type: String,
    default: 'Nuova Chat',
    trim: true,
    maxlength: 100
  },
  conversationSummary: {
    type: String,
    default: ''
  },
  keyFacts: [{
    fact: String,
    extractedAt: {
      type: Date,
      default: Date.now
    }
  }],
  messageCount: {
    type: Number,
    default: 0
  },
  lastMessageAt: {
    type: Date,
    default: Date.now
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

/**
 * L'indice della cronologia segue `lastMessageAt`, non `updatedAt`.
 *
 * È il campo su cui la lista viene ordinata e quello che l'interfaccia mostra
 * accanto a ogni riga («questo minuto», «13 minuti fa»): ordinare su un campo e
 * mostrarne un altro produce una lista le cui etichette contraddicono il
 * proprio ordine.
 */
chatSchema.index({ userId: 1, lastMessageAt: -1 });
chatSchema.index({ userId: 1, characterId: 1 });

chatSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

/**
 * `updatedAt` va aggiornato anche quando si scrive per query.
 *
 * Il hook `pre('save')` qui sopra copriva solo `doc.save()`. Ma ogni messaggio
 * inviato aggiorna la chat con `findByIdAndUpdate`, che NON lo esegue: misurato,
 * `updatedAt` restava identico a `createdAt` per tutta la vita della
 * conversazione. Era un campo che dichiarava una cosa falsa, esposto nella
 * risposta della API e usato per ordinare la cronologia — con il risultato che
 * la chat a cui si era appena risposto compariva SOTTO una più vecchia e mai
 * toccata.
 *
 * L'ordinamento ora usa `lastMessageAt`; questo hook serve perché `updatedAt`
 * smetta comunque di mentire a chiunque altro lo legga.
 */
chatSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function(next) {
  this.set({ updatedAt: new Date() });
  next();
});

module.exports = mongoose.model('Chat', chatSchema);
