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

  await mongoose.connect(uri, {
    maxPoolSize: 50,
    minPoolSize: 5,
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
