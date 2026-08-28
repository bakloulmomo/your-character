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
  stripeCustomerId: {
    type: String,
    default: null
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
   * chiunque. Si assegna con `scripts/grantRole.js` o tramite ADMIN_EMAILS.
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

  // Recupero password: si conserva solo l'impronta del token, mai il token in
  // chiaro — chi leggesse il database non potrebbe usarlo per entrare.
  passwordResetTokenHash: {
    type: String,
    default: null,
    select: false
  },
  passwordResetExpiresAt: {
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
    const user = await User.findOneAndUpdate(
      { _id: userId, credits: { $gte: cost } },
      { $inc: { credits: -cost } },
      { new: true }
    );
    if (!user) return null;
    return {
      user,
      refund: () => User.findByIdAndUpdate(userId, { $inc: { credits: cost } }, { new: true })
    };
  }

  const limits = limitsFor(subscription);
  if (!limits) {
    return { user: await User.findById(userId), refund: async () => User.findById(userId) };
  }

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

