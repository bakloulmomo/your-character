const mongoose = require('mongoose');

const characterSchema = new mongoose.Schema({
  // Basic info
  name: {
    type: String,
    required: true,
    minlength: 2,
    maxlength: 60,
    trim: true
  },
  description: {
    type: String,
    required: true,
    minlength: 10,
    maxlength: 500,
    trim: true
  },
  
  // Personality configuration
  personality: {
    type: String,
    required: true,
    minlength: 20,
    maxlength: 2000,
    trim: true
  },
  backstory: {
    type: String,
    maxlength: 1500,
    default: '',
    trim: true
  },
  greetingMessage: {
    type: String,
    default: 'Ciao! Di cosa vorresti parlare oggi?',
    maxlength: 300,
    trim: true
  },
  
  /**
   * Istruzioni inviate al modello.
   *
   * `select: false` come per `passwordHash`: il campo NON esce da nessuna
   * query se non viene chiesto esplicitamente con `.select('+systemPrompt')`.
   *
   * Prima la protezione era una proiezione `-systemPrompt` ripetuta a mano su
   * ogni rotta, e bastava dimenticarla una volta perché il campo uscisse:
   * `GET /api/chats/:id` faceva `.populate('characterId')` senza proiezione e
   * restituiva le istruzioni di qualunque personaggio pubblico a chiunque
   * aprisse una chat. Una difesa che dipende dal ricordarsene a ogni query è
   * una difesa che prima o poi manca; qui il default è sicuro e l'eccezione
   * va dichiarata.
   */
  systemPrompt: {
    type: String,
    required: true,
    select: false
  },
  
  // Visuals & Categorization
  avatar: {
    type: String,
    required: true
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  category: {
    type: String,
    enum: ['anime', 'gaming', 'assistant', 'historical', 'fantasy', 'roleplay', 'custom'],
    default: 'custom'
  },
  
  // Access control & Ownership
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  isPublic: {
    type: Boolean,
    default: false
  },
  
  // Usage stats
  usageCount: {
    type: Number,
    default: 0
  },
  chatCount: {
    type: Number,
    default: 0
  },
  
  // Moderation & NSFW Flag
  isNSFW: {
    type: Boolean,
    default: false
  },
  /**
   * Stato di revisione (FASE D — S2-2).
   *
   * Il default era `approved`: chiunque pubblicava in galleria con un click,
   * senza che nessuno guardasse nulla. Ora un personaggio PUBBLICO nasce
   * `pending` e compare in galleria solo dopo la revisione; un personaggio
   * PRIVATO nasce `approved` perché non è visibile a nessun altro ed è
   * immediatamente utilizzabile dal suo creatore.
   * La regola è applicata in `routes/characters.js`, dove si conosce `isPublic`.
   */
  moderationStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  moderationReason: {
    type: String,
    default: '',
    maxlength: 500
  },
  moderatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  moderatedAt: {
    type: Date,
    default: null
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

// Indexes for fast searching and filtering
characterSchema.index({ isPublic: 1, moderationStatus: 1, isNSFW: 1, usageCount: -1 });
characterSchema.index({ moderationStatus: 1, createdAt: -1 });
characterSchema.index({ createdBy: 1, isPublic: 1 });
characterSchema.index({ tags: 1 });
characterSchema.index({ name: 'text', description: 'text', personality: 'text' });

characterSchema.pre('validate', function(next) {
  this.updatedAt = Date.now();
  
  // Auto-generate system prompt if not provided
  if (!this.systemPrompt && this.name && this.personality) {
    this.systemPrompt = `You are ${this.name}. ${this.personality}. ${this.backstory ? `Backstory: ${this.backstory}` : ''}`;
  }
  
  next();
});

module.exports = mongoose.model('Character', characterSchema);
