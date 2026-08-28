#!/usr/bin/env node
/**
 * Ambiente completo per i test end-to-end (FASE E — punto 3).
 *
 * Avvia un MongoDB in memoria, lo popola con dati deterministici e fa partire
 * l'API vera. Playwright poi guida un browser vero contro l'applicazione vera.
 *
 * Perché in memoria e non un mongod di sistema: un test E2E che richiede un
 * database installato a mano è un test che gira sulla macchina di chi l'ha
 * scritto e su nessun'altra — men che meno in CI. Qui l'unica dipendenza è
 * `mongodb-memory-server`, che è già una dipendenza di sviluppo del server.
 *
 * Il processo resta vivo finché non viene terminato; alla chiusura smonta tutto.
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const PORT = process.env.E2E_API_PORT || 5051;

/**
 * Dati di partenza: due personaggi pubblici approvati (la galleria non deve
 * essere vuota) e uno in attesa di revisione, così la coda di moderazione ha
 * qualcosa da mostrare senza che il test debba prima crearlo.
 */
const SEED_CHARACTERS = [
  {
    _id: '650000000000000000000001',
    name: 'Aria Thorne',
    description: 'Coach di scrittura e storytelling per autori e sceneggiatori.',
    personality: 'Brillante, empatica e metodica: aiuta a superare il blocco dello scrittore.',
    greetingMessage: 'Ciao! Di quale storia vuoi parlare oggi?',
    avatar: 'https://example.com/aria.jpg',
    tags: ['scrittura', 'storytelling'],
    category: 'assistant',
    isPublic: true,
    moderationStatus: 'approved'
  },
  {
    _id: '650000000000000000000002',
    name: 'Marcus Vance',
    description: 'Netrunner in una metropoli distopica, sempre a caccia della prossima breccia.',
    personality: 'Cinico e astuto, parla per mezze frasi e non si fida di nessuno.',
    greetingMessage: 'Hai trenta secondi. Parla.',
    avatar: 'https://example.com/marcus.jpg',
    tags: ['cyberpunk', 'roleplay'],
    category: 'roleplay',
    isPublic: true,
    moderationStatus: 'approved'
  }
];

async function main() {
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('your-character-e2e');

  process.env.MONGODB_URI = uri;
  process.env.NODE_ENV = 'development';
  process.env.PORT = String(PORT);
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'warn';
  // Risposte deterministiche e fatturabili: servono a verificare l'economia dei
  // crediti (esaurimento → acquisto → ripresa) senza chiamare un modello vero.
  process.env.AI_MODE = 'stub';
  // Il primo account con questo indirizzo diventa amministratore: è così che il
  // test può aprire la coda di moderazione.
  process.env.ADMIN_EMAILS = 'staff@e2e.test';
  // I limiti restano attivi (un E2E che gira senza protezioni non verifica
  // l'app reale), ma con una soglia compatibile con esecuzioni ripetute: il
  // percorso registra un account per volta dallo stesso indirizzo.
  process.env.REGISTER_RATE_MAX = process.env.REGISTER_RATE_MAX || '200';
  process.env.LOGIN_RATE_MAX = process.env.LOGIN_RATE_MAX || '200';

  await mongoose.connect(uri);
  const Character = require('../models/Character');
  const User = require('../models/User');

  const owner = await User.create({
    email: 'catalogo@e2e.test',
    username: 'catalogo',
    authProvider: 'local',
    birthdate: new Date('1990-01-01')
  });

  await Character.insertMany(
    SEED_CHARACTERS.map((c) => ({
      ...c,
      createdBy: owner._id,
      systemPrompt: `You are ${c.name}. ${c.personality}`
    }))
  );

  // `server.js` avvia da sé quando NODE_ENV non è 'test': si limita a chiedere
  // il bootstrap, che riusa la connessione già aperta.
  require('../server');

  const shutdown = async () => {
    try {
      await mongoose.disconnect();
      await mongo.stop();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log(`[e2e] API su http://127.0.0.1:${PORT} · MongoDB in memoria pronto`);
}

main().catch((err) => {
  console.error('[e2e] avvio dell\'ambiente fallito:', err);
  process.exit(1);
});
