/**
 * Ambiente dei test — deterministico e indipendente da `.env`.
 *
 * `server.js` chiama `dotenv.config()` all'import, quindi finora i test
 * ereditavano le credenziali reali presenti sulla macchina di chi li eseguiva.
 * Conseguenza misurata: bastava mettere una chiave Stripe vera in `server/.env`
 * perché `mockPaymentsEnabled()` diventasse falso e 10 test cadessero — mentre
 * in CI, dove `.env` non esiste, la stessa suite restava verde. Una suite che
 * cambia risposta a seconda di un file non versionato non è più una verifica.
 *
 * Qui le credenziali dei servizi esterni vengono fissate a segnaposto PRIMA che
 * qualsiasi modulo venga importato. `dotenv` non sovrascrive le variabili già
 * definite, quindi questi valori vincono su quelli del file.
 *
 * Effetto: pagamenti simulati e motore AI in modalità 'stub' in ogni ambiente.
 * I test che vogliono un'altra modalità continuano a impostarla da sé a runtime.
 */
process.env.NODE_ENV = 'test';

/**
 * Segreto di firma dei token.
 *
 * Sette file di test firmano i JWT leggendo `process.env.JWT_SECRET` grezzo
 * invece di passare da `jwtSecret()`, che fuori produzione ha un valore di
 * ripiego. Senza `.env` la variabile non esiste e `jwt.sign` fallisce con
 * «secretOrPrivateKey must have a value»: è il motivo per cui la suite sarebbe
 * stata rossa in CI, dove `.env` non viene mai depositato.
 *
 * Il valore deve essere lo STESSO che vede l'applicazione: `jwtSecret()`
 * restituisce questa variabile quando è impostata, quindi i token firmati dai
 * test si verificano correttamente nelle rotte.
 */
process.env.JWT_SECRET = 'segreto_di_firma_riservato_alla_suite_di_test_0000';


// Pagamenti: percorso simulato, nessuna chiamata alla vera API di Stripe.
process.env.STRIPE_SECRET_KEY = 'sk_test_stripe_sample';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_sample';
delete process.env.STRIPE_PRICE_MONTHLY;
delete process.env.STRIPE_PRICE_ANNUAL;

// Motore AI e generatore di immagini: risposte deterministiche, nessun costo.
// Senza questo, il giorno in cui metti una GEMINI_API_KEY vera in `.env` la
// suite comincerebbe a chiamare il modello davvero — lentamente, a pagamento e
// con esiti diversi a ogni esecuzione.
process.env.GEMINI_API_KEY = 'mock_gemini_key';
process.env.STABILITY_API_KEY = 'mock_stability_key';

// Recapiti e raccolta errori: nessun invio verso l'esterno durante i test.
delete process.env.RESEND_API_KEY;
delete process.env.SENTRY_DSN;

/**
 * Funzionalità ACCESE nei test, spente in produzione.
 *
 * Sembra una contraddizione e non lo è. Pagamenti, abbonamenti e immagini
 * restano spenti nel prodotto per ragioni economiche e legali, ma il loro
 * codice esiste, è completo e dovrà funzionare il giorno in cui si riaccende.
 * Un codice che nessun test percorre più è codice che si guasta in silenzio e
 * lo scopri al momento peggiore — cioè quando decidi di incassare.
 *
 * `tests/features.test.js` fa il contrario: cancella queste variabili per
 * verificare che da spente le rotte siano davvero chiuse.
 */
process.env.FEATURE_PAYMENTS = 'true';
process.env.FEATURE_SUBSCRIPTIONS = 'true';
process.env.FEATURE_IMAGE_GENERATION = 'true';
