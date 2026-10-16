const mongoose = require('mongoose');
const logger = require('../services/logger');

/**
 * Establishes the shared Mongoose connection used by every model.
 * Called once at server startup (skipped under NODE_ENV=test, where the
 * test harness manages its own in-memory connection).
 */
async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/your-character';

  mongoose.connection.on('error', (err) => {
    logger.error({ err: { message: err.message } }, 'Errore di connessione a MongoDB');
  });
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnesso');
  });

  /**
   * La dimensione del pool è un budget CONDIVISO, non una preferenza locale.
   *
   * Il tetto di connessioni è del cluster, non del processo: su Atlas M0 sono
   * 500 in tutto, e ogni istanza dell'applicazione ne prenota fino a
   * `maxPoolSize`. Con un valore fisso di 50 il conto tornava finché l'istanza
   * era una sola — cioè finché non si scala, che è esattamente il momento in
   * cui il limite si scopre, e lo si scopre come errori di connessione sotto
   * carico invece che come una riga di configurazione.
   *
   * Ora è una variabile d'ambiente: chi aggiunge la seconda istanza dimezza
   * questo numero invece di scoprire il tetto in produzione.
   */
  const maxPoolSize = Number(process.env.MONGO_MAX_POOL_SIZE) || 20;

  await mongoose.connect(uri, {
    maxPoolSize,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000
  });

  // Gli indici vanno creati PRIMA di servire traffico: su un database nuovo la
  // prima query che ne dipende fallirebbe altrimenti con un errore 500.
  try {
    await mongoose.syncIndexes();
    logger.info('Indici del database sincronizzati');
  } catch (err) {
    logger.warn({ err: { message: err.message } }, 'Sincronizzazione degli indici non riuscita');
  }

  logger.info('Connessione a MongoDB stabilita');
}

module.exports = connectDB;
