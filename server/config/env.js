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
 * Interruttori di funzionalità.
 *
 * Il prodotto parte come BETA CHIUSA E GRATUITA: niente pagamenti, niente
 * abbonamenti, niente generazione di immagini. Non è una limitazione tecnica,
 * è una decisione economica e legale precisa:
 *
 *  · PAGAMENTI — incassare in modo continuativo richiede una partita IVA e la
 *    registrazione OSS per l'IVA sui clienti UE. Finché non ci sono, accettare
 *    denaro non è un'opzione. Il codice resta completo e testato: si riaccende
 *    con una variabile d'ambiente il giorno in cui i dati fiscali esistono.
 *
 *  · ABBONAMENTI — un abbonamento incassa una volta e poi produce costi per
 *    trenta giorni senza tetto correlato al prezzo. Con i tetti attuali un
 *    abbonato annuale che usa ciò che ha pagato costa ~146$ contro ~53$ di
 *    ricavo netto. I pacchetti crediti hanno il comportamento opposto — il
 *    ricavo PRECEDE sempre il costo, con margine ~90-95% qualunque uso ne
 *    faccia l'utente — quindi la beta usa solo quelli.
 *
 *  · IMMAGINI — costano $0.025 l'una contro $0.0015 di un messaggio: sono
 *    diciassette volte più care e sono l'unica voce capace di far male su
 *    scala piccola. Restano spente finché non c'è un ricavo che le sostenga.
 *
 * Il valore predefinito è SEMPRE quello prudente: una variabile dimenticata
 * lascia la funzione spenta, non accesa. È la stessa direzione di fallimento
 * scelta per NODE_ENV.
 */
const flagEnabled = (name) => process.env[name] === 'true';

const features = () => ({
  payments: flagEnabled('FEATURE_PAYMENTS'),
  subscriptions: flagEnabled('FEATURE_SUBSCRIPTIONS'),
  imageGeneration: flagEnabled('FEATURE_IMAGE_GENERATION')
});

/**
 * Crediti assegnati a un nuovo account.
 *
 * In beta gratuita servono a far provare il prodotto davvero: dieci crediti
 * sono dieci messaggi, cioè meno di una conversazione, e con i pagamenti
 * spenti non ci sarebbe alcun modo di proseguire. Il valore è configurabile
 * perché il numero giusto dipende dalla fase, non dal codice.
 */
const welcomeCredits = () => {
  const n = Number.parseInt(process.env.WELCOME_CREDITS, 10);
  if (Number.isInteger(n) && n >= 0 && n <= 100000) return n;
  return features().payments ? 10 : 100;
};

/**
 * Codice d'invito per la beta chiusa.
 *
 * Se impostato, la registrazione lo richiede. È ciò che rende «chiusa» una
 * beta chiusa: senza, chiunque trovi l'indirizzo può iscriversi, e con i
 * crediti di cortesia ogni iscritto è un costo in chiamate al modello.
 * Non impostandolo, la registrazione resta aperta.
 */
const betaInviteCode = () => (process.env.BETA_INVITE_CODE || '').trim() || null;

/**
 * Tetto giornaliero di messaggi per singolo utente.
 *
 * Serve a proteggere una risorsa CONDIVISA: il piano gratuito di Gemini
 * concede un numero fisso di richieste al giorno per l'intero progetto, non
 * per utente. Senza un tetto individuale, una sola persona particolarmente
 * presa dalla conversazione esaurirebbe la quota di tutti entro mezzogiorno, e
 * gli altri troverebbero un'app che non risponde.
 *
 * Non e' una limitazione commerciale — i crediti restano quelli — e' una
 * ripartizione equa di una capacita' che non e' elastica. Vale per gli utenti
 * gratuiti; chi paga ha i limiti del proprio piano.
 *
 * `0` o assente = nessun tetto.
 */
const betaDailyMessageCap = () => {
  const n = Number.parseInt(process.env.BETA_DAILY_MESSAGE_CAP, 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

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

  /**
   * Stripe è richiesto SOLO se i pagamenti sono accesi.
   *
   * In beta gratuita non si incassa nulla, quindi pretendere le chiavi
   * impedirebbe il deploy di un'applicazione che non ne ha alcun bisogno. Il
   * legame giusto è con la funzione, non con l'ambiente: se accendi
   * FEATURE_PAYMENTS senza saper incassare, il server non parte — ed è
   * esattamente quando quel controllo serve.
   *
   * Sono accettate sia le chiavi segrete (`sk_`) sia quelle RISTRETTE (`rk_`).
   * Stripe raccomanda le seconde: portano solo i permessi che si assegnano
   * loro, quindi una chiave trafugata può fare molto meno danno.
   */
  if (features().payments) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      problems.push('STRIPE_SECRET_KEY: mancante, ma FEATURE_PAYMENTS è attivo — senza chiave reale nessun pagamento è possibile.');
    } else if (isPlaceholder(stripeKey) || !/^(sk|rk)_(live|test)_/.test(stripeKey)) {
      problems.push('STRIPE_SECRET_KEY: è un segnaposto, non una chiave Stripe reale (attese sk_ o rk_).');
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      problems.push('STRIPE_WEBHOOK_SECRET: mancante — senza di esso le notifiche di pagamento non sono verificabili, e i crediti di chi paga non verrebbero mai accreditati.');
    } else if (isPlaceholder(webhookSecret)) {
      problems.push('STRIPE_WEBHOOK_SECRET: è un segnaposto, non il segreto reale dell\'endpoint webhook.');
    }

    // Vendere senza intestazione fiscale significa emettere ricevute che
    // dichiarano il vero solo perché ammettono di essere provvisorie. Non è
    // una base su cui incassare da clienti reali.
    if (!sellerDetails().configured) {
      problems.push('SELLER_NAME / SELLER_VAT_NUMBER / SELLER_ADDRESS: mancanti, ma FEATURE_PAYMENTS è attivo — le ricevute sarebbero prive di intestazione fiscale.');
    }
  }

  if (features().subscriptions && !features().payments) {
    problems.push('FEATURE_SUBSCRIPTIONS è attivo ma FEATURE_PAYMENTS no: gli abbonamenti non possono esistere senza pagamenti.');
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
  features,
  welcomeCredits,
  betaInviteCode,
  betaDailyMessageCap,
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
