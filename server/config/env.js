/**
 * Configurazione e guardie d'ambiente.
 *
 * Un singolo punto in cui si decide che cosa è permesso in quale ambiente.
 * La regola è una sola: ogni scorciatoia comoda in sviluppo (pagamenti finti,
 * risposte AI simulate, segreti di default) deve essere IRRAGGIUNGIBILE in
 * produzione — e il server deve rifiutarsi di partire se la configurazione
 * reale non c'è, invece di ripiegare in silenzio su quella finta.
 */

const DEFAULT_JWT_SECRET = 'your_character_super_secret_jwt_key_2026_secure';
const MIN_JWT_SECRET_LENGTH = 32;

const PLACEHOLDER_MARKERS = ['sample', 'placeholder', 'changeme', 'your_', 'mock_', 'xxx'];

const isPlaceholder = (value) => {
  if (!value || typeof value !== 'string') return true;
  const lowered = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker));
};

/**
 * Qualunque ambiente che non sia esplicitamente `development` o `test` viene
 * trattato come produzione — NODE_ENV dimenticato compreso.
 *
 * L'alternativa (`NODE_ENV === 'production'`) fallisce nella direzione
 * sbagliata: basterebbe una variabile non impostata sul server per riattivare
 * i pagamenti simulati e il segreto JWT di default in un ambiente pubblico.
 */
const RELAXED_ENVIRONMENTS = ['development', 'test'];

const isProduction = () => !RELAXED_ENVIRONMENTS.includes(process.env.NODE_ENV);
const isTest = () => process.env.NODE_ENV === 'test';

/**
 * Segreto di firma dei JWT. In produzione non esiste alcun fallback: se manca
 * o è quello di default il processo non deve nemmeno arrivare qui, perché
 * assertProductionEnv() ha già fatto fallire l'avvio.
 */
const jwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (isProduction()) {
    if (!secret || secret === DEFAULT_JWT_SECRET || secret.length < MIN_JWT_SECRET_LENGTH) {
      throw new Error('JWT_SECRET non configurato correttamente in produzione');
    }
    return secret;
  }
  return secret || DEFAULT_JWT_SECRET;
};

/**
 * I pagamenti simulati (checkout senza Stripe + /payments/confirm manuale)
 * esistono solo fuori produzione, e solo se non è configurata una chiave vera.
 */
const mockPaymentsEnabled = () => {
  if (isProduction()) return false;
  const key = process.env.STRIPE_SECRET_KEY;
  return !key || isPlaceholder(key);
};

/**
 * Modalità del motore AI:
 *   'live'     → chiavi reali, risposte reali, credito addebitato
 *   'stub'     → risposte deterministiche per i test, credito addebitato
 *                (serve a poter verificare l'economia senza chiamare l'API)
 *   'degraded' → nessuna chiave in sviluppo: risposte simulate ed ETICHETTATE,
 *                e soprattutto NON fatturate
 *   'fail'     → guasto simulato (solo test)
 *   'unsafe'   → risposta deliberatamente vietata (solo test): serve a
 *                verificare che la moderazione dell'OUTPUT intervenga davvero
 * In produzione 'degraded' non è raggiungibile: senza chiave il server non parte,
 * e nessuna modalità forzata viene onorata.
 */
const FORCED_MODES = ['live', 'stub', 'degraded', 'fail', 'unsafe'];

/**
 * `AI_MODE` è una leva di sviluppo e di test, e in produzione non deve esistere.
 *
 * Difetto trovato durante la FASE D: la versione precedente onorava la variabile
 * in QUALSIASI ambiente. Bastava impostare `AI_MODE=stub` su un server pubblico
 * per servire risposte preconfezionate addebitando crediti veri — la stessa
 * classe di problema di S0-1 e S0-9, su un'altra leva.
 */
const forcedMode = () => {
  const forced = process.env.AI_MODE;
  if (isProduction()) return null;
  return FORCED_MODES.includes(forced) ? forced : null;
};

const aiMode = () => {
  const forced = forcedMode();
  if (forced) return forced;

  const geminiConfigured = !!process.env.GEMINI_API_KEY && !isPlaceholder(process.env.GEMINI_API_KEY);
  if (geminiConfigured) return 'live';
  if (isTest()) return 'stub';
  return 'degraded';
};

const imageMode = () => {
  const forced = forcedMode();
  if (forced) return forced;

  const stabilityConfigured = !!process.env.STABILITY_API_KEY && !isPlaceholder(process.env.STABILITY_API_KEY);
  if (stabilityConfigured) return 'live';
  if (isTest()) return 'stub';
  return 'degraded';
};

/**
 * Account con privilegi di moderazione, elencati come variabile d'ambiente
 * (FASE D — S2-13). È il modo in cui nasce il PRIMO moderatore: senza un
 * innesco esterno, la coda di revisione resterebbe inaccessibile a tutti.
 * Gli altri si assegnano con `scripts/grantRole.js`.
 */
const adminEmails = () =>
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

/**
 * Dati del venditore per ricevute e IVA (FASE D — S2-12).
 * Sono segnaposto dichiarati: una ricevuta con un'intestazione inventata
 * sarebbe peggio di una ricevuta assente, quindi `configured` dice la verità
 * su quanto è stato compilato davvero.
 */
const sellerDetails = () => ({
  name: process.env.SELLER_NAME || null,
  vatNumber: process.env.SELLER_VAT_NUMBER || null,
  address: process.env.SELLER_ADDRESS || null,
  country: (process.env.SELLER_COUNTRY || 'IT').toUpperCase(),
  ossRegistered: process.env.SELLER_OSS_REGISTERED === 'true',
  get configured() {
    return !!(this.name && this.vatNumber && this.address);
  }
});

/**
 * Validazione fail-fast della configurazione di produzione.
 * Raccoglie TUTTI i problemi e li segnala insieme: un deploy incompleto va
 * scoperto in una sola volta, non un segreto alla volta.
 */
function assertProductionEnv() {
  if (!isProduction()) return;

  const problems = [];

  if (!process.env.MONGODB_URI) {
    problems.push('MONGODB_URI: manca la stringa di connessione al database.');
  }
  if (!process.env.FRONTEND_URL) {
    problems.push('FRONTEND_URL: manca l\'origine autorizzata per CORS e per i redirect di pagamento.');
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    problems.push('JWT_SECRET: mancante.');
  } else if (secret === DEFAULT_JWT_SECRET) {
    problems.push('JWT_SECRET: è ancora il valore di default presente nel repository — chiunque potrebbe firmare token validi per qualsiasi account.');
  } else if (secret.length < MIN_JWT_SECRET_LENGTH) {
    problems.push(`JWT_SECRET: troppo corto (${secret.length} caratteri, minimo ${MIN_JWT_SECRET_LENGTH}).`);
  }

  // Sono accettate sia le chiavi segrete (`sk_`) sia quelle RISTRETTE (`rk_`).
  // Stripe raccomanda le seconde: portano solo i permessi che si assegnano
  // loro, quindi una chiave trafugata può fare molto meno danno. La versione
  // precedente ammetteva solo `sk_`, e chi avesse seguito quella
  // raccomandazione si sarebbe visto rifiutare l'avvio del server.
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    problems.push('STRIPE_SECRET_KEY: mancante — senza chiave reale nessun pagamento è possibile.');
  } else if (isPlaceholder(stripeKey) || !/^(sk|rk)_(live|test)_/.test(stripeKey)) {
    problems.push('STRIPE_SECRET_KEY: è un segnaposto, non una chiave Stripe reale (attese sk_ o rk_).');
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    problems.push('STRIPE_WEBHOOK_SECRET: mancante — senza di esso le notifiche di pagamento non sono verificabili.');
  } else if (isPlaceholder(webhookSecret)) {
    problems.push('STRIPE_WEBHOOK_SECRET: è un segnaposto, non il segreto reale dell\'endpoint webhook.');
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey || isPlaceholder(geminiKey)) {
    problems.push('GEMINI_API_KEY: mancante o segnaposto — l\'app risponderebbe con testo simulato facendolo pagare agli utenti.');
  }

  if (problems.length > 0) {
    throw new Error(
      'Configurazione di produzione incompleta. Il server non viene avviato.\n\n' +
      problems.map((p) => `  • ${p}`).join('\n') +
      '\n\nCorreggi le variabili d\'ambiente e riavvia.'
    );
  }
}

module.exports = {
  DEFAULT_JWT_SECRET,
  isProduction,
  isTest,
  isPlaceholder,
  jwtSecret,
  mockPaymentsEnabled,
  adminEmails,
  sellerDetails,
  aiMode,
  imageMode,
  assertProductionEnv
};
