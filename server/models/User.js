const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // Clerk Integration (Optional for local auth)
  clerkId: {
    type: String,
    required: false,
    sparse: true,
    index: true
  },

  // Authentication Provider
  authProvider: {
    type: String,
    enum: ['local', 'clerk'],
    default: 'local'
  },
  
  // Local Password Security
  passwordHash: {
    type: String,
    required: false,
    select: false // Never return password hash by default
  },
  
  // Profile Information
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  username: {
    type: String,
    required: true,
    unique: true,
    minlength: 3,
    maxlength: 30,
    trim: true
  },
  avatar: {
    type: String,
    default: null
  },
  birthdate: {
    type: Date,
    default: null
  },
  
  // Credits & Subscription
  credits: {
    type: Number,
    default: 10, // Initial 10 free credits
    min: 0
  },
  subscription: {
    type: String,
    enum: ['free', 'monthly', 'annual'],
    default: 'free'
  },
  subscriptionExpiresAt: {
    type: Date,
    default: null
  },
  // Filtro di tre rotte di pagamento (rinnovo, disdetta, aggiornamento
  // abbonamento): senza indice ognuna scansionava l'intera collezione utenti.
  stripeCustomerId: {
    type: String,
    default: null,
    index: true
  },
  // Disdetta programmata: l'accesso resta attivo fino a subscriptionExpiresAt.
  subscriptionCancelAtPeriodEnd: {
    type: Boolean,
    default: false
  },
  
  // Usage tracking (Daily limits for subscription tiers)
  dailyMessageCount: {
    type: Number,
    default: 0
  },
  dailyImageCount: {
    type: Number,
    default: 0
  },
  lastResetDate: {
    type: Date,
    default: Date.now
  },
  
  /**
   * Ruolo (FASE D — S2-13). Serve a proteggere la coda di revisione: senza un
   * ruolo, «interfaccia di moderazione» significherebbe endpoint aperti a
   * chiunque. Si assegna SOLO con `scripts/grantRole.js`, che richiede
   * l'accesso al database: un privilegio non può nascere da un dato che
   * l'utente stesso fornisce, come un indirizzo email mai verificato.
   */
  role: {
    type: String,
    enum: ['user', 'moderator', 'admin'],
    default: 'user',
    index: true
  },

  /**
   * Preferenza esplicita per i contenuti per adulti (FASE D — S2-3).
   * Non basta da sola: il server la incrocia sempre con la maggiore età
   * calcolata da `birthdate`.
   */
  nsfwEnabled: {
    type: Boolean,
    default: false
  },

  /**
   * Consenso ai cookie registrato lato server (FASE D — S2-6).
   * Il GDPR richiede di poter DIMOSTRARE il consenso: tenerlo solo nel
   * localStorage del browser, come prima, non lo dimostra e lo perde a ogni
   * cambio di dispositivo.
   */
  cookieConsent: {
    functional: { type: Boolean, default: false },
    version: { type: String, default: null },
    updatedAt: { type: Date, default: null }
  },

  /**
   * Paese di consumo ai fini IVA (FASE D — S2-12). Determina l'aliquota
   * applicata alle vendite digitali B2C nell'Unione (regime OSS).
   */
  billingCountry: {
    type: String,
    uppercase: true,
    minlength: 2,
    maxlength: 2,
    default: null
  },

  // Security & Account Status
  isBanned: {
    type: Boolean,
    default: false
  },
  banReason: {
    type: String,
    default: null
  },
  banExpiresAt: {
    type: Date,
    default: null
  },
  lastLoginAt: {
    type: Date,
    default: null
  },

  /**
   * Verifica dell'indirizzo email.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Prima non esisteva, e il codice lo diceva apertamente in `routes/auth.js`:
   * «L'email, qui, non e' un'identita' — e' una stringa che il richiedente
   * sceglie». Due conseguenze concrete: ci si registrava con l'indirizzo di
   * un'altra persona, e `POST /forgot-password` mandava a quella persona posta
   * che non aveva chiesto.
   *
   * Si conserva solo l'IMPRONTA del codice, come per i token di recupero: chi
   * leggesse il database non potrebbe confermare un indirizzo altrui. Il codice
   * a sei cifre e' abbastanza corto da riscriverlo a mano da un telefono e
   * abbastanza protetto dal tetto di tentativi: un milione di combinazioni con
   * cinque prove e quindici minuti di validita' rendono la forza bruta inutile
   * senza allungare il codice fino a farlo incollare.
   * ───────────────────────────────────────────────────────────────────────────
   */
  emailVerifiedAt: {
    type: Date,
    default: null,
    index: true
  },
  emailVerificationCodeHash: {
    type: String,
    default: null,
    select: false
  },
  emailVerificationExpiresAt: {
    type: Date,
    default: null,
    select: false
  },
  /**
   * Tentativi falliti sul codice corrente. Si azzera a ogni nuovo invio: e' il
   * tetto per codice, non per account — altrimenti un utente che sbaglia a
   * digitare tre volte resterebbe chiuso fuori per sempre.
   */
  emailVerificationAttempts: {
    type: Number,
    default: 0,
    select: false
  },
  emailVerificationSentAt: {
    type: Date,
    default: null,
    select: false
  },
  /**
   * Quando questo account scade se non viene mai confermato.
   *
   * E' l'UNICO campo di questo schema con un indice TTL, e la distinzione e'
   * quella che rende il TTL sicuro: un indice TTL cancella il DOCUMENTO, non il
   * campo. Legarlo a `passwordResetExpiresAt` cancellerebbe l'account un'ora
   * dopo aver chiesto di recuperare la password — qui invece la scadenza del
   * campo coincide davvero con la fine di cio' che il documento rappresenta.
   *
   * Serve a non lasciare occupato per sempre l'indirizzo di un'altra persona:
   * chi si registra con l'email di qualcun altro e non puo' confermarla libera
   * quell'indirizzo dopo sette giorni. Diventa `null` alla conferma, e un
   * documento con il campo nullo il TTL non lo tocca.
   */
  unverifiedExpiresAt: {
    type: Date,
    default: null
  },

  // Recupero password: si conserva solo l'impronta del token, mai il token in
  // chiaro — chi leggesse il database non potrebbe usarlo per entrare.
  passwordResetTokenHash: {
    type: String,
    default: null,
    select: false,
    // Filtro di `/reset-password`: cinque tentativi all'ora per indirizzo IP,
    // ma nessun tetto globale, quindi senza indice era una scansione completa
    // della collezione utenti a richiesta.
    index: true
  },
  passwordResetExpiresAt: {
    type: Date,
    default: null,
    select: false
  },

  /**
   * Tentativi di accesso falliti CONSECUTIVI, e blocco temporaneo.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Il limitatore su `/login` conta per INDIRIZZO IP: cinque tentativi ogni
   * quindici minuti. Protegge bene dal singolo attaccante e per niente da uno
   * distribuito — con mille indirizzi diventano cinquemila tentativi ogni
   * quindici minuti contro un singolo account, e nessuno dei due limiti se ne
   * accorge perche' ciascun IP resta sotto la propria soglia. Il conto qui e'
   * per ACCOUNT, cioe' sull'asse che l'attacco sta davvero percorrendo.
   *
   * IL COMPROMESSO, DETTO APERTAMENTE. Un blocco per account e' anche un modo
   * per impedire a una persona di entrare: chi conosce l'indirizzo di qualcuno
   * puo' sbagliare la password apposta e tenerlo fuori. Per questo il blocco e'
   * BREVE (quindici minuti) e non progressivo all'infinito: costa a un
   * attaccante il 99% del suo ritmo, e alla vittima un'attesa. Un blocco che
   * richiede l'intervento di un amministratore sarebbe una difesa peggiore del
   * problema.
   *
   * E il messaggio d'errore resta identico a quello di una password sbagliata:
   * chi tenta non deve poter distinguere «bloccato» da «errata», altrimenti il
   * blocco stesso diventa un oracolo che conferma quali account esistono.
   * ───────────────────────────────────────────────────────────────────────────
   */
  failedLoginAttempts: {
    type: Number,
    default: 0,
    select: false
  },
  lockedUntil: {
    type: Date,
    default: null,
    select: false
  },

  // Versione della sessione: viene incrementata a ogni logout (e a ogni futuro
  // cambio password). I JWT portano questo numero e vengono rifiutati quando
  // non corrisponde più — è ciò che rende un logout davvero definitivo.
  tokenVersion: {
    type: Number,
    default: 0
  },
  
  // GDPR & Compliance
  gdprConsented: {
    type: Boolean,
    default: true
  },
  gdprConsentedAt: {
    type: Date,
    default: Date.now
  },
  
  // Timestamps
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

// Indexes
userSchema.index({ subscription: 1, subscriptionExpiresAt: 1 });

/**
 * Scadenza degli account mai confermati.
 *
 * `expireAfterSeconds: 0` significa «cancella quando la data nel campo e'
 * passata», non «cancella subito»: la scadenza la decide il documento. I
 * documenti in cui il campo e' `null` — cioe' tutti gli account confermati —
 * il TTL li ignora, ed e' questo che rende sicuro un indice che altrimenti
 * cancellerebbe utenti veri.
 */
userSchema.index({ unverifiedExpiresAt: 1 }, { expireAfterSeconds: 0 });

userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

/**
 * Limiti giornalieri per piano. Unica fonte di verità: prima erano scritti a
 * mano dentro i metodi del modello e di nuovo nell'interfaccia, con il rischio
 * che divergessero in silenzio.
 */
const DAILY_LIMITS = {
  monthly: { messages: 50, images: 5 },
  annual: { messages: 100, images: 10 }
};

const limitsFor = (subscription) => DAILY_LIMITS[subscription] || null;

// Helper Methods
/**
 * L'indirizzo e' stato confermato.
 *
 * Fallisce chiuso come `isAdult()`: senza data di conferma la risposta e' no.
 * Gli account creati prima che la verifica esistesse vengono confermati d'ufficio
 * da `scripts/grandfatherVerified.js` — una decisione presa una volta e
 * annotata, non un'eccezione che vive nel codice per sempre.
 */
userSchema.methods.isEmailVerified = function() {
  return !!this.emailVerifiedAt;
};

/**
 * Maggiore età calcolata dalla data di nascita dichiarata.
 * Se la data manca, la risposta è NO: l'assenza del dato non può valere come
 * conferma: sarebbe un age gate che si apre da solo.
 */
userSchema.methods.isAdult = function() {
  if (!this.birthdate) return false;
  const birth = new Date(this.birthdate);
  if (Number.isNaN(birth.getTime())) return false;
  const eighteenth = new Date(birth.getFullYear() + 18, birth.getMonth(), birth.getDate());
  return eighteenth <= new Date();
};

/** Può vedere contenuti per adulti: maggiorenne E con preferenza attiva. */
userSchema.methods.canSeeNSFW = function() {
  return this.isAdult() && this.nsfwEnabled === true;
};

userSchema.methods.isStaff = function() {
  return this.role === 'moderator' || this.role === 'admin';
};

userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

userSchema.methods.resetDailyCounts = function() {
  this.dailyMessageCount = 0;
  this.dailyImageCount = 0;
  this.lastResetDate = Date.now();
  return this.save();
};

userSchema.methods.canSendMessage = function() {
  if (this.isBanned) return false;
  if (this.subscription === 'free') return this.credits > 0;
  const limits = limitsFor(this.subscription);
  return !limits || this.dailyMessageCount < limits.messages;
};

userSchema.methods.canGenerateImage = function() {
  if (this.isBanned) return false;
  if (this.subscription === 'free') return this.credits >= IMAGE_CREDIT_COST;
  const limits = limitsFor(this.subscription);
  return !limits || this.dailyImageCount < limits.images;
};

const IMAGE_CREDIT_COST = 10;
const MESSAGE_CREDIT_COST = 1;

const User = mongoose.model('User', userSchema);

/**
 * Riserva l'allowance PRIMA di chiamare il modello, in una sola operazione
 * atomica condizionata.
 *
 * È il cuore della correzione S1-1/S1-2: il controllo precedente leggeva uno
 * snapshot dell'utente e addebitava solo dopo la risposta, quindi N richieste
 * simultanee passavano tutte il controllo e ricevevano tutte una risposta,
 * pagandone solo alcune. Qui il filtro e l'incremento avvengono insieme: se il
 * documento non soddisfa la condizione, l'operazione non trova nulla e la
 * richiesta viene rifiutata prima di spendere una chiamata API.
 *
 * @returns {Promise<{user: object, refund: function}|null>} null se non c'è allowance
 */
async function reserveAllowance(userId, subscription, kind) {
  const isImage = kind === 'image';
  const cost = isImage ? IMAGE_CREDIT_COST : MESSAGE_CREDIT_COST;

  if (subscription === 'free') {
    /**
     * Due condizioni in una sola operazione atomica: credito sufficiente E
     * tetto giornaliero non superato.
     *
     * Il tetto protegge la quota GRATUITA di Gemini, che e' per progetto e non
     * per utente: senza, una persona sola la esaurirebbe per tutti. Metterlo
     * qui e non in un controllo separato e' obbligatorio — due letture
     * distinte lascerebbero la stessa finestra di concorrenza che
     * `reserveAllowance` esiste per chiudere.
     */
    const { betaDailyMessageCap } = require('../config/env');
    const cap = isImage ? 0 : betaDailyMessageCap();

    const filter = { _id: userId, credits: { $gte: cost } };
    const update = { $inc: { credits: -cost } };
    if (cap > 0) {
      filter.dailyMessageCount = { $lt: cap };
      update.$inc.dailyMessageCount = 1;
    }

    const user = await User.findOneAndUpdate(filter, update, { new: true });
    if (!user) {
      // Distingue le due ragioni del rifiuto: «hai finito i crediti» e «hai
      // raggiunto il tetto di oggi» richiedono all'utente azioni diverse.
      if (cap > 0) {
        const current = await User.findById(userId).select('credits dailyMessageCount').lean();
        if (current && current.credits >= cost && current.dailyMessageCount >= cap) {
          return { blockedBy: 'dailyCap', cap };
        }
      }
      return null;
    }

    const undo = { $inc: { credits: cost } };
    if (cap > 0) undo.$inc.dailyMessageCount = -1;
    return {
      user,
      refund: () => User.findByIdAndUpdate(userId, undo, { new: true })
    };
  }

  /**
   * Piano sconosciuto ⇒ NESSUNA allowance (S3).
   *
   * Qui la riga era l'opposto:
   *
   *     if (!limits) return { user: await User.findById(userId), refund: ... };
   *
   * cioè un valore di `subscription` non previsto concedeva chiamate al modello
   * ILLIMITATE, senza addebito e con un rimborso che non rimborsava niente. È
   * un fallimento in apertura, in una funzione il cui unico scopo è chiudere.
   *
   * Non era irraggiungibile. L'enum dello schema non protegge, perché ogni
   * scrittura di `subscription` passa da `findByIdAndUpdate`, che in Mongoose
   * NON esegue i validator se non glielo si chiede — e non glielo si chiedeva.
   * Bastava una regressione in `/subscribe` o un metadato storto in un evento
   * Stripe per lasciare un account su `subscription: 'pro'`, e da lì in poi
   * quell'account avrebbe consumato la quota Gemini condivisa a costo zero,
   * senza che nulla lo segnalasse.
   *
   * `runValidators: true` è stato aggiunto sulle tre scritture in
   * routes/payments.js; questa riga è la seconda difesa, quella che regge anche
   * se un valore sconosciuto arriva lo stesso.
   */
  const limits = limitsFor(subscription);
  if (!limits) return null;

  const counter = isImage ? 'dailyImageCount' : 'dailyMessageCount';
  const ceiling = isImage ? limits.images : limits.messages;

  const user = await User.findOneAndUpdate(
    { _id: userId, [counter]: { $lt: ceiling } },
    { $inc: { [counter]: 1 } },
    { new: true }
  );
  if (!user) return null;
  return {
    user,
    refund: () => User.findByIdAndUpdate(userId, { $inc: { [counter]: -1 } }, { new: true })
  };
}

module.exports = User;
module.exports.DAILY_LIMITS = DAILY_LIMITS;
module.exports.IMAGE_CREDIT_COST = IMAGE_CREDIT_COST;
module.exports.MESSAGE_CREDIT_COST = MESSAGE_CREDIT_COST;
module.exports.reserveAllowance = reserveAllowance;

