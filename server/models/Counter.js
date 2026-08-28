const mongoose = require('mongoose');

/**
 * Sequenze atomiche (FASE D — S2-12).
 *
 * La numerazione delle ricevute deve essere progressiva e senza buchi né
 * duplicati. Contare i documenti esistenti (`countDocuments() + 1`) sembra
 * equivalente e non lo è: due richieste simultanee leggono lo stesso numero e
 * producono due ricevute con lo stesso identificativo.
 *
 * `findOneAndUpdate` con `$inc` è invece una sola operazione atomica lato
 * database: due richieste ottengono due numeri diversi, sempre.
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});

const Counter = mongoose.model('Counter', counterSchema);

/**
 * @param {string} name identificativo della sequenza (es. `invoice:2026`)
 * @returns {Promise<number>} il numero successivo, mai restituito due volte
 */
async function nextSequence(name) {
  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
}

module.exports = Counter;
module.exports.nextSequence = nextSequence;
