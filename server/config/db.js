const mongoose = require('mongoose');

/**
 * Establishes the shared Mongoose connection used by every model.
 * Called once at server startup (skipped under NODE_ENV=test, where the
 * test harness manages its own in-memory connection).
 */
async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/your-character';

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  MongoDB disconnected');
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
    console.log('✅ Indici del database sincronizzati');
  } catch (err) {
    console.warn('⚠️  Sincronizzazione indici non riuscita:', err.message);
  }

  console.log('✅ MongoDB connected');
}

module.exports = connectDB;
