# Piano Architettura e Implementazione Codice - AI Character Chat App

## 1. Architettura Generale del Sistema

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Client Layer                        │
├─────────────────────────────────────────────────────────────┤
│  React Frontend (Vite)  │  Mobile App (Future)  │  Admin   │
│  - Next.js/React         │  - React Native       │  Dashboard│
│  - TailwindCSS           │  - Swift/Kotlin        │           │
│  - Clerk Auth            │                        │           │
└─────────────────────────────────────────────────────────────┘
                              │ HTTPS/WSS
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      API Gateway Layer                      │
├─────────────────────────────────────────────────────────────┤
│  - Rate Limiting (Redis)  │  - Authentication (Clerk)      │
│  - Request Validation     │  - CORS Configuration          │
│  - Security Headers       │  - Logging (Sentry)             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer (Node.js)              │
├─────────────────────────────────────────────────────────────┤
│  User Service          │  Character Service  │  Chat Service│
│  - Auth/Profile        │  - CRUD            │  - Messages   │
│  - Credits             │  - Search          │  - Context    │
│                        │  - Public/Private  │  - AI API     │
├─────────────────────────────────────────────────────────────┤
│  Payment Service       │  Image Service      │  Admin Service│
│  - Stripe Integration │  - Stability AI    │  - Stats      │
│  - Webhooks           │  - Cloudinary       │  - Bans       │
│                        │  - Generation       │              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Data Layer                              │
├─────────────────────────────────────────────────────────────┤
│  MongoDB Atlas         │  Redis Cache        │  File Storage│
│  - Users               │  - Sessions         │  - Cloudinary │
│  - Characters          │  - Rate Limits      │  - Images     │
│  - Chats               │  - Context Cache    │              │
│  - Messages           │  - Hot Data         │              │
│  - Transactions       │                     │              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   External APIs                             │
├─────────────────────────────────────────────────────────────┤
│  Google Gemini API    │  Stability AI       │  Stripe API   │
│  - Chat Completion     │  - Image Gen        │  - Payments   │
│  - Context Caching     │                     │  - Webhooks   │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Technology Stack Detail

**Frontend:**
```json
{
  "framework": "React 18 + Vite",
  "styling": "TailwindCSS + shadcn/ui",
  "auth": "@clerk/clerk-react",
  "state": "Zustand",
  "http": "Axios",
  "forms": "React Hook Form + Zod",
  "realtime": "HTTP polling (MVP)",
  "build": "Vite"
}
```

**Backend:**
```json
{
  "runtime": "Node.js 20 LTS",
  "framework": "Express.js",
  "auth": "@clerk/backend",
  "validation": "Zod",
  "database": "Mongoose 8",
  "cache": "ioredis",
  "http": "Axios",
  "realtime": "HTTP (MVP)",
  "queue": "None (MVP)",
  "logging": "Winston + Sentry"
}
```

**Infrastructure:**
```json
{
  "frontend_hosting": "Render.com",
  "backend_hosting": "Render.com",
  "database": "MongoDB Atlas M0",
  "cache": "Upstash Redis",
  "storage": "Cloudinary",
  "monitoring": "Sentry",
  "analytics": "PostHog",
  "cdn": "Cloudflare (optional)"
}
```

---

## 2. Database Schema Design

### 2.1 User Schema

```javascript
// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // Clerk integration
  clerkId: { 
    type: String, 
    required: true, 
    unique: true,
    index: true 
  },
  
  // Profile
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
    maxlength: 20,
    match: /^[a-zA-Z0-9_]+$/
  },
  avatar: {
    type: String,
    default: null
  },
  
  // Credits system
  credits: {
    type: Number,
    default: 10, // 10 free messages
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
  
  // Usage tracking
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
  
  // Security
  isBanned: {
    type: Boolean,
    default: false
  },
  banReason: String,
  banExpiresAt: Date,
  devices: [{
    deviceId: String,
    userAgent: String,
    lastSeen: Date,
    isTrusted: { type: Boolean, default: false }
  }],
  
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
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ clerkId: 1 });
userSchema.index({ subscription: 1, subscriptionExpiresAt: 1 });

// Pre-save middleware
userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Methods
userSchema.methods.resetDailyCounts = function() {
  this.dailyMessageCount = 0;
  this.dailyImageCount = 0;
  this.lastResetDate = Date.now();
  return this.save();
};

userSchema.methods.canSendMessage = function() {
  if (this.isBanned) return false;
  
  if (this.subscription === 'free') {
    return this.credits > 0;
  }
  
  // Subscription users have daily limits
  const dailyLimit = this.subscription === 'monthly' ? 50 : 100;
  return this.dailyMessageCount < dailyLimit;
};

userSchema.methods.canGenerateImage = function() {
  if (this.isBanned) return false;
  
  if (this.subscription === 'free') {
    return this.credits >= 10;
  }
  
  const dailyLimit = this.subscription === 'monthly' ? 5 : 10;
  return this.dailyImageCount < dailyLimit;
};

module.exports = mongoose.model('User', userSchema);
```

### 2.2 Character Schema

```javascript
// models/Character.js
const mongoose = require('mongoose');

const characterSchema = new mongoose.Schema({
  // Basic info
  name: {
    type: String,
    required: true,
    minlength: 2,
    maxlength: 50,
    trim: true
  },
  description: {
    type: String,
    required: true,
    minlength: 10,
    maxlength: 500
  },
  
  // Personality configuration
  personality: {
    type: String,
    required: true,
    minlength: 20,
    maxlength: 2000
  },
  backstory: {
    type: String,
    maxlength: 1000,
    default: ''
  },
  
  // System prompt for AI
  systemPrompt: {
    type: String,
    required: true
  },
  
  // Visual
  avatar: {
    type: String,
    required: true
  },
  tags: [{
    type: String,
    trim: true
  }],
  
  // Access control
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
  
  // Content moderation
  isNSFW: {
    type: Boolean,
    default: false
  },
  moderationStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
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
characterSchema.index({ createdBy: 1, isPublic: 1 });
characterSchema.index({ isPublic: 1, usageCount: -1 });
characterSchema.index({ tags: 1 });
characterSchema.index({ name: 'text', description: 'text', personality: 'text' });

// Pre-save middleware
characterSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // Generate system prompt if not provided
  if (!this.systemPrompt) {
    this.systemPrompt = `You are ${this.name}. ${this.personality}. ${this.backstory ? `Backstory: ${this.backstory}` : ''}`;
  }
  
  next();
});

module.exports = mongoose.model('Character', characterSchema);
```

### 2.3 Chat Schema

```javascript
// models/Chat.js
const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  // Participants
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  characterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Character',
    required: true,
    index: true
  },
  
  // Chat metadata
  title: {
    type: String,
    default: 'New Chat'
  },
  
  // Context management
  conversationSummary: {
    type: String,
    default: ''
  },
  keyFacts: [{
    fact: String,
    extractedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Usage stats
  messageCount: {
    type: Number,
    default: 0
  },
  lastMessageAt: {
    type: Date,
    default: Date.now
  },
  
  // Settings
  userPreferences: {
    tone: {
      type: String,
      enum: ['casual', 'formal', 'romantic', 'friendly'],
      default: 'casual'
    },
    nsfwEnabled: {
      type: Boolean,
      default: false
    }
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
chatSchema.index({ userId: 1, updatedAt: -1 });
chatSchema.index({ characterId: 1 });
// RIMOSSO: unique constraint - un utente può avere multiple chat con lo stesso character

module.exports = mongoose.model('Chat', chatSchema);
```

### 2.4 Message Schema

```javascript
// models/Message.js
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true,
    index: true
  },
  
  // Message content
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  
  // AI metadata
  tokens: {
    input: Number,
    output: Number,
    total: Number
  },
  model: {
    type: String,
    default: 'gemini-2.5-flash'
  },
  
  // Images (if any)
  image: {
    url: String,
    prompt: String,
    generationId: String
  },
  
  // Cost tracking
  cost: {
    type: Number,
    default: 0
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true
  }
});

// Indexes
messageSchema.index({ chatId: 1, createdAt: -1 });
messageSchema.index({ createdAt: -1 }); // For cleanup

module.exports = mongoose.model('Message', messageSchema);
```

### 2.5 Session Schema (CRITICO per character condivisi)

```javascript
// models/Session.js
const sessionSchema = new mongoose.Schema({
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  characterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Character',
    required: true,
    index: true
  },
  context: [{
    role: { type: String, enum: ['system', 'user', 'assistant'] },
    content: String
  }],
  keyFacts: [String],
  lastActive: {
    type: Date,
    default: Date.now
  }
});

// Critical: una session per singola chat (evita collisioni se l'utente ha più chat con lo stesso character)
sessionSchema.index({ chatId: 1 }, { unique: true });
sessionSchema.index({ userId: 1, characterId: 1 });

module.exports = mongoose.model('Session', sessionSchema);
```

### 2.6 Transaction Schema

```javascript
// models/Transaction.js
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Transaction details
  type: {
    type: String,
    enum: ['purchase', 'subscription', 'refund', 'bonus'],
    required: true
  },
  
  // Credits
  credits: {
    type: Number,
    required: true
  },
  
  // Payment
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'EUR'
  },
  
  // Stripe integration
  stripePaymentIntentId: String,
  stripeSubscriptionId: String,
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  
  // Idempotency
  idempotencyKey: {
    type: String,
    unique: true,
    sparse: true
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true
  },
  completedAt: Date
});

// Indexes
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ idempotencyKey: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
```

---

## 3. API Architecture

### 3.1 API Structure

```
/api/
├── /auth/
│   ├── POST /register
│   ├── POST /login
│   ├── POST /logout
│   ├── GET /me
│   └── POST /refresh
├── /users/
│   ├── GET /me
│   ├── PUT /me
│   ├── GET /me/credits
│   └── GET /me/stats
├── /characters/
│   ├── GET / (list)
│   ├── GET /:id
│   ├── POST / (create)
│   ├── PUT /:id
│   ├── DELETE /:id
│   ├── GET /public
│   └── GET /my-characters
├── /chats/
│   ├── GET / (list)
│   ├── GET /:id
│   ├── POST / (create)
│   ├── DELETE /:id
│   └── POST /:id/messages
├── /messages/
│   ├── POST / (send)
│   ├── GET /:chatId
│   └── DELETE /:id
├── /payments/
│   ├── POST /purchase-credits
│   ├── POST /create-subscription
│   ├── POST /cancel-subscription
│   └── GET /transactions
├── /images/
│   ├── POST /generate
│   └── GET /:id
└── /admin/
    ├── GET /stats
    ├── GET /users
    ├── POST /ban-user
    └── GET /transactions
```

### 3.2 API Implementation Example

**Base Express Setup:**

```javascript
// server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const { clerkMiddleware } = require('@clerk/express');
const Sentry = require('@sentry/node');

require('dotenv').config();

const app = express();

// Sentry
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV
});

// Middleware
app.use(Sentry.Handlers.requestHandler());
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));
app.use(clerkMiddleware());

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/characters', require('./routes/characters'));
app.use('/api/chats', require('./routes/chats'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/images', require('./routes/images'));
app.use('/api/admin', require('./routes/admin'));

// Error handling
app.use(Sentry.Handlers.errorHandler());
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

**Chat API Implementation:**

```javascript
// routes/messages.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { rateLimiter } = require('../middleware/rateLimit');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const Character = require('../models/Character');
const geminiService = require('../services/geminiService');
const contextManager = require('../services/contextManager');

// Send message
router.post('/', requireAuth, rateLimiter, async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    await session.withTransaction(async () => {
      const { chatId, content } = req.body;
      const userId = req.user.id;
      
      // Validate input
      if (!content || content.length > 2000) {
        return res.status(400).json({ error: 'Invalid message content' });
      }
      
      // Get user and check credits
      const user = await User.findById(userId).session(session);
      if (!user.canSendMessage()) {
        return res.status(402).json({ 
          error: 'Insufficient credits or daily limit reached' 
        });
      }
      
      // Get chat
      const chat = await Chat.findById(chatId).session(session);
      if (!chat || chat.userId.toString() !== userId) {
        return res.status(404).json({ error: 'Chat not found' });
      }
      
      // Get character
      const character = await Character.findById(chat.characterId).session(session);
      if (!character) {
        return res.status(404).json({ error: 'Character not found' });
      }
      
      // Save user message
      const userMessage = await Message.create([{
        chatId,
        role: 'user',
        content
      }], { session });
      
      // Build context
      const context = await contextManager.buildContext(chatId, character);
      context.push({ role: 'user', content });
      
      // Call Gemini API
      const aiResponse = await geminiService.generateResponse(context);
      
      // Save AI message
      const aiMessage = await Message.create([{
        chatId,
        role: 'assistant',
        content: aiResponse.content,
        tokens: aiResponse.tokens,
        cost: aiResponse.cost
      }], { session });
      
      // Update user credits
      if (user.subscription === 'free') {
        user.credits -= 1;
      } else {
        user.dailyMessageCount += 1;
      }
      await user.save({ session });
      
      // Update chat stats
      chat.messageCount += 2;
      chat.lastMessageAt = Date.now();
      await chat.save({ session });
      
      // Update character usage
      character.usageCount += 1;
      await character.save({ session });
      
      res.json({
        userMessage: userMessage[0],
        aiMessage: aiMessage[0],
        creditsRemaining: user.credits
      });
    });
  } catch (error) {
    console.error('Message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  } finally {
    await session.endSession();
  }
});

// Get chat messages
router.get('/:chatId', requireAuth, async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;
    
    // Verify chat ownership
    const chat = await Chat.findOne({ _id: chatId, userId });
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    const messages = await Message.find({ chatId })
      .sort({ createdAt: 1 })
      .limit(100);
    
    res.json(messages);
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

module.exports = router;
```

---

## 4. Service Layer Architecture

### 4.1 Gemini Service

```javascript
// services/geminiService.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { estimateTokens } = require('../utils/tokenUtils');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const MAX_TOKENS = 100000;
const TARGET_OUTPUT_TOKENS = 1000;

async function generateResponse(context) {
  try {
    const inputTokens = estimateTokens(context);
    
    if (inputTokens > MAX_TOKENS * 0.8) {
      throw new Error('Context too large, requires summarization');
    }
    
    // Separa la system instruction dai messaggi di conversazione
    const systemMessage = context.find(m => m.role === 'system');
    const conversationMessages = context.filter(m => m.role !== 'system');
    
    // Inizializza il modello Gemini Flash con la System Instruction corretta
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: systemMessage ? systemMessage.content : undefined
    });
    
    const formattedContents = conversationMessages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));
    
    const result = await model.generateContent({
      contents: formattedContents,
      generationConfig: {
        maxOutputTokens: TARGET_OUTPUT_TOKENS,
        temperature: 0.7,
        topK: 40,
        topP: 0.95
      }
    });
    
    const response = result.response;
    const text = response.text();
    
    const outputTokens = estimateTokens([{ content: text }]);
    const cost = calculateCost(inputTokens, outputTokens);
    
    return {
      content: text,
      tokens: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens
      },
      cost
    };
  } catch (error) {
    console.error('Gemini API error:', error);
    throw new Error('Failed to generate AI response');
  }
}

async function generateSummary(messagesToSummarize) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const prompt = `Summarize key dialogue events and details briefly:\n` + 
    messagesToSummarize.map(m => `${m.role}: ${m.content}`).join('\n');
  const result = await model.generateContent(prompt);
  return result.response.text();
}

function calculateCost(inputTokens, outputTokens) {
  const inputCost = (inputTokens / 1000000) * 0.30;
  const outputCost = (outputTokens / 1000000) * 2.50;
  return inputCost + outputCost;
}

module.exports = { generateResponse, generateSummary };
```

### 4.2 Context Manager Service

```javascript
// services/contextManager.js
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const Session = require('../models/Session');
const Character = require('../models/Character');

async function buildContext(chatId, userId, characterId) {
  try {
    let session = await Session.findOne({ chatId });
    
    if (!session) {
      const character = await Character.findById(characterId);
      if (!character) throw new Error('Character not found');
      
      session = await Session.create({
        chatId,
        userId,
        characterId,
        context: [{
          role: 'system',
          content: character.systemPrompt
        }]
      });
    }
    
    session.lastActive = new Date();
    await session.save();
    
    return session.context;
  } catch (error) {
    console.error('Context building error:', error);
    throw error;
  }
}

async function updateSession(chatId, userMessage, aiResponse) {
  await Session.findOneAndUpdate(
    { chatId },
    {
      $push: {
        context: {
          $each: [
            { role: 'user', content: userMessage },
            { role: 'assistant', content: aiResponse }
          ]
        }
      },
      lastActive: new Date()
    }
  );
}

async function summarizeConversation(chatId, geminiService) {
  const session = await Session.findOne({ chatId });
  if (!session || session.context.length < 30) return;
  
  const systemPrompt = session.context.find(m => m.role === 'system') || {
    role: 'system',
    content: 'You are a friendly AI companion.'
  };
  
  const conversationMessages = session.context.filter(m => m.role !== 'system');
  const recentMessages = conversationMessages.slice(-20);
  const oldMessages = conversationMessages.slice(0, -20);
  
  const summaryText = await geminiService.generateSummary(oldMessages);
  
  session.context = [
    systemPrompt,
    { role: 'system', content: `Summary of previous conversation context: ${summaryText}` },
    ...recentMessages
  ];
  
  await session.save();
}

module.exports = { buildContext, updateSession, summarizeConversation };
```

### 4.3 Image Generation Service

```javascript
// services/imageService.js
const axios = require('axios');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

const STABILITY_API_KEY = process.env.STABILITY_API_KEY;
const STABILITY_API_URL = 'https://api.stability.ai/v2beta/image-generation';

async function generateImage(userId, prompt) {
  try {
    // Check user credits
    const user = await User.findById(userId);
    if (!user.canGenerateImage()) {
      throw new Error('Insufficient credits for image generation');
    }
    
    // Call Stability AI API
    const response = await axios.post(
      `${STABILITY_API_URL}/text-to-image`,
      {
        text_prompts: [{ text: prompt }],
        cfg_scale: 7,
        height: 1024,
        width: 1024,
        steps: 30,
        samples: 1
      },
      {
        headers: {
          Authorization: `Bearer ${STABILITY_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const imageData = response.data.artifacts[0];
    
    // Upload to Cloudinary
    const cloudinaryUrl = await uploadToCloudinary(imageData.base64);
    
    // Deduct credits
    if (user.subscription === 'free') {
      user.credits -= 10;
    } else {
      user.dailyImageCount += 1;
    }
    await user.save();
    
    // Record transaction
    await Transaction.create({
      userId,
      type: 'purchase',
      credits: -10,
      amount: 0.10,
      status: 'completed',
      completedAt: new Date()
    });
    
    return {
      url: cloudinaryUrl,
      prompt,
      cost: 0.10
    };
  } catch (error) {
    console.error('Image generation error:', error);
    throw new Error('Failed to generate image');
  }
}

async function uploadToCloudinary(base64Image) {
  const cloudinary = require('cloudinary').v2;
  
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  
  const result = await cloudinary.uploader.upload(
    `data:image/png;base64,${base64Image}`,
    {
      folder: 'character-images',
      transformation: [
        { width: 1024, height: 1024, crop: 'limit' },
        { quality: 'auto' }
      ]
    }
  );
  
  return result.secure_url;
}

module.exports = { generateImage };
```

---

## 5. Frontend Architecture

### 5.1 Project Structure

```
src/
├── components/
│   ├── ui/              # shadcn/ui components
│   ├── auth/            # Auth components
│   ├── character/       # Character components
│   ├── chat/            # Chat components
│   └── admin/           # Admin components
├── pages/
│   ├── index.tsx        # Home
│   ├── login.tsx        # Login
│   ├── characters.tsx   # Character list
│   ├── chat.tsx         # Chat interface
│   └── admin.tsx        # Admin dashboard
├── hooks/
│   ├── useAuth.ts
│   ├── useChat.ts
│   └── useCharacters.ts
├── services/
│   ├── api.ts           # API client
│   ├── auth.ts          # Auth service
│   └── websocket.ts     # Socket.io
├── store/
│   ├── authStore.ts     # Auth state
│   ├── chatStore.ts     # Chat state
│   └── characterStore.ts
├── types/
│   ├── index.ts         # TypeScript types
│   └── api.ts           # API response types
├── utils/
│   ├── validation.ts    # Zod schemas
│   └── formatting.ts    # Helper functions
└── App.tsx
```

### 5.2 State Management (Zustand)

```typescript
// store/chatStore.ts
import { create } from 'zustand';
import { Chat, Message } from '@/types';

interface ChatStore {
  currentChat: Chat | null;
  messages: Message[];
  isLoading: boolean;
  setCurrentChat: (chat: Chat | null) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  setLoading: (loading: boolean) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  currentChat: null,
  messages: [],
  isLoading: false,
  
  setCurrentChat: (chat) => set({ currentChat: chat }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message]
  })),
  setLoading: (isLoading) => set({ isLoading })
}));
```

---

## 6. Piano di Implementazione Sequenziale End-to-End (Roadmap Agente AI Completa)

Questo piano definisce **8 Fasi Operative** sequenziali ed esaustive per la costruzione dell'intera applicazione SaaS production-ready. Nessun modulo (Legale, GDPR, Moderazione, Design System) è stato tralasciato.

---

### 📍 FASE 1: Setup Progetto, Dipendenze e Design System "Blue & Black"
* **Obiettivo**: Inizializzare i repository Backend/Frontend, configurare le variabili d'ambiente e definire il Design System cromatico personalizzato "Blue & Black" ispirato ai prodotti UI human-crafted di livello enterprise (Linear, Vercel, Perplexity).
* **Palette Colori & Design System**:
  - `bg-main`: Deep Midnight Obsidian (`#060913` / `#0B0F19`)
  - `bg-card`: Translucent Slate-Blue Glass (`#111827` / `#162032` con border `#1E293B`)
  - `accent-primary`: Electric Sapphire Blue (`#2563EB` / `#3B82F6`)
  - `accent-glow`: Neon Cyan/Royal Blue (`#06B6D4` / `#60A5FA`)
  - `text-main`: Crisp White (`#F8FAFC`), `text-muted`: Cool Slate (`#94A3B8`)
  - `font`: Outfit / Inter (Google Fonts)
* **File Coinvolti**:
  - `server/package.json` [NEW]
  - `server/.env` / `server/.env.example` [NEW]
  - `server/server.js` [NEW]
  - `client/package.json` [NEW]
  - `client/src/index.css` [NEW] (Design tokens, glassmorphism, scrollbars scure, glow effects)
* **Task Puntuali**:
  1. Inizializzare Express (`express`, `cors`, `helmet`, `mongoose`, `zod`, `@google/generative-ai`, `@clerk/express`, `dotenv`, `morgan`).
  2. Inizializzare React Vite TS (`@clerk/clerk-react`, `zustand`, `axios`, `lucide-react`, `tailwindcss`, `clsx`, `tailwind-merge`).
  3. Definire i token CSS del Design System "Blue & Black" con sfumature ed effetti neon glow sulle chat e sulle card.
* **Verifica della Fase**:
  - `server/server.js` risponde con HTTP 200 su `/health`.
  - Frontend Vite compila i CSS tokens senza avvisi ed applica il tema scuro blu/nero.

---

### 📍 FASE 2: Modelli Database Mongoose Completi, Schemi Zod e Seed
* **Obiettivo**: Definire la persistenza dei dati incluse le tabelle per GDPR, Termini di Servizio e Segnalazione Contenuti (Moderazione).
* **File Coinvolti**:
  - `server/models/User.js` [NEW] (inclusi campi GDPR consent, ban, crediti)
  - `server/models/Character.js` [NEW] (incluso flag NSFW, status approvazione, tags)
  - `server/models/Chat.js` [NEW]
  - `server/models/Message.js` [NEW]
  - `server/models/Session.js` [NEW] (chiavato su `chatId` univoco)
  - `server/models/Transaction.js` [NEW] (idempotency Stripe)
  - `server/models/Report.js` [NEW] (segnalazioni abusi/contenuti)
  - `server/utils/validation.js` [NEW] (Validazione Zod per tutti gli input)
  - `server/scripts/seedCharacters.js` [NEW]
* **Task Puntuali**:
  1. Definire i 7 modelli Mongoose con indici ottimizzati per performance.
  2. Implementare la validazione Zod per ogni payload (messaggi, creazione character, report, pagamenti).
  3. Script di seeding con 5 Character pubblici iniziali dotati di system prompt avanzati.
* **Verifica della Fase**:
  - Test unitario di istanziazione di tutti e 7 i modelli Mongoose con esito positivo.

---

### 📍 FASE 3: Autenticazione Clerk, Diritti GDPR e API User/Character
* **Obiettivo**: Protezione rotte backend, sincronizzazione utente e conformità GDPR (cancellazione account ed esportazione dati).
* **File Coinvolti**:
  - `server/middleware/auth.js` [NEW] (Clerk JWT validation)
  - `server/routes/users.js` [NEW] (`GET /me`, `DELETE /me` [GDPR], `GET /me/export` [GDPR])
  - `server/routes/characters.js` [NEW] (`GET /`, `POST /`, `GET /:id`, `PUT /:id`, `DELETE /:id`)
* **Task Puntuali**:
  1. Middleware Clerk per la verifica dei token Bearer.
  2. Endpoint GDPR: `DELETE /api/users/me` per eliminare l'account ed i dati personali dell'utente; `GET /api/users/me/export` per l'estrazione ZIP/JSON dei propri dati.
  3. API CRUD dei Character con paginazione e ricerca testuale.
* **Verifica della Fase**:
  - Verificato il blocco 401 per chiamate non autenticate ed il funzionamento della cancellazione/esportazione dati GDPR.

---

### 📍 FASE 4: Motore di Chat Gemini API, Context Manager & Moderazione Automatica
* **Obiettivo**: Core conversational engine con isolamento contestuale per chat, summarization automatica e filtro di moderazione contenuti.
* **File Coinvolti**:
  - `server/services/geminiService.js` [NEW] (SDK Gemini 1.5/2.0 Flash con `systemInstruction` e summarizer)
  - `server/services/contextManager.js` [NEW] (Sessioni su `chatId` e retention memoria)
  - `server/services/moderationService.js` [NEW] (Filtro parole d'odio/contenuti illegali)
  - `server/routes/chats.js` [NEW]
  - `server/routes/messages.js` [NEW] (invio messaggi, deduzione atomica crediti `$inc` fuori da transazioni DB)
* **Task Puntuali**:
  1. Configurare `geminiService` per passare correttamente il `systemPrompt` ed evitare la perdita di memoria.
  2. Implementare la moderazione automatica prima di inoltrare la richiesta a Gemini.
  3. Endpoint `POST /api/messages` con consumo crediti atomico.
* **Verifica della Fase**:
  - Test d'integrazione di invio messaggi: risposte coerenti, crediti scalati, 2 chat diverse con lo stesso character mantengono memoria separata.

---

### 📍 FASE 5: Generazione Immagini AI & Stripe Webhook Idempotente
* **Obiettivo**: Generazione avatar/immagini in-chat e ricarica crediti via Stripe con verifica firma HMAC.
* **File Coinvolti**:
  - `server/services/imageService.js` [NEW] (Stability AI / fallback)
  - `server/routes/images.js` [NEW] (`POST /generate`)
  - `server/routes/payments.js` [NEW] (Stripe Checkout Sessions & Webhook HMAC)
* **Task Puntuali**:
  1. Implementare la generazione immagini con deduzione di 10 crediti.
  2. Configurare i pacchetti crediti d'ingresso ($2.99, $4.99, $14.99) e abbonamento $4.99/mese.
  3. Webhook handler Stripe con verifica firma ed idempotency per evitare addebiti doppi.
* **Verifica della Fase**:
  - Invio di webhook simulato Stripe CLI: accredito crediti verificato con successo.

---

### 📍 FASE 6: Sistema di Segnalazione (Report Abusi) e Pagine Legali (Terms & Privacy)
* **Obiettivo**: Garanzia di conformità legale, Termini di Servizio, Informativa sulla Privacy e sistema di report dei contenuti generati dagli utenti.
* **File Coinvolti**:
  - `server/routes/reports.js` [NEW] (`POST /api/reports` per segnalare character/messaggi inappropriati)
  - `client/src/pages/TermsPage.tsx` [NEW] (Termini e Condizioni d'Uso)
  - `client/src/pages/PrivacyPage.tsx` [NEW] (Privacy Policy & Cookie Policy GDPR)
* **Task Puntuali**:
  1. Creare l'endpoint di segnalazione abuso per permettere agli utenti di notificare contenuti inappropriati.
  2. Redigere le pagine Legali leggibili nel frontend (`/terms`, `/privacy`) ed il banner per la Cookie/Age Consent.
* **Verifica della Fase**:
  - Invio di un report da API registrato su DB; pagine legali fruibili da rotte pubbliche.

---

### 📍 FASE 7: Frontend React UI Human-Grade "Blue & Black" (Ispirazione Vercel/Linear)
* **Obiettivo**: Costruire un'interfaccia utente spettacolare, lontana dallo stile generico AI ("AI slop UI"), curata nei dettagli, micro-animazioni, palette blu e nera profonda.
* **Componenti UI**:
  - **Header & Navbar**: Vetro traslucido scuro con bordo blu brillante, Clerk Auth Button, contatore crediti animato con bagliore neon.
  - **Hero & Character Gallery**: Griglia bento-box scura con schede character ad alto contrasto, badge di stato, hover 3D subtle ed etichette tag.
  - **Chat Interface**: Bar di input galleggiante stile Perplexity/Linear, bolle messaggio con sfumatura blu zaffiro per l'utente e nero ossidiana per l'AI, indicatore di scrittura a punti animati, pulsante integrato "Genera Immagine".
  - **Modale Ricarica Crediti**: Card opache con bordi al neon blu, pulsanti d'azione gradienti.
* **File Coinvolti**:
  - `client/src/components/Navbar.tsx` [NEW]
  - `client/src/components/CharacterCard.tsx` [NEW]
  - `client/src/components/ChatWindow.tsx` [NEW]
  - `client/src/components/CreditModal.tsx` [NEW]
  - `client/src/components/ReportModal.tsx` [NEW]
  - `client/src/pages/HomePage.tsx` [NEW]
  - `client/src/pages/ChatPage.tsx` [NEW]
  - `client/src/pages/CreateCharacterPage.tsx` [NEW]
  - `client/src/pages/ProfilePage.tsx` [NEW] (inclusi pulsanti esportazione/eliminazione GDPR)
* **Verifica della Fase**:
  - Rendering su browser fluido, esteticamente eccezionale, responsivo ed esente da errori in console.

---

### 📍 FASE 8: Testing Completo (Unit, Integration, Security, Load, E2E) & Documentazione
* **Obiettivo**: Esecuzione della suite completa delle 5 Fasi di Test, validazione build ed elaborazione della relazione finale.
* **File Coinvolti**:
  - `server/tests/unit.test.js` [NEW]
  - `server/tests/integration.test.js` [NEW]
  - `server/tests/security.test.js` [NEW]
  - `walkthrough.md` [NEW]
* **Task Puntuali**:
  1. Eseguire tutti i test unitari e di integrazione.
  2. Verificare la sanitizzazione XSS, blocco NoSQL injection e blocco prompt injection.
  3. Verificare la compilazione senza errori (`npm run build` su server e client).
  4. Redigere il report finale in `walkthrough.md`.
* **Verifica della Fase**:
  - Suite di test completata con successo (100% pass). App pronta per il deployment.

---

## 7. Code Quality Standards

### 7.1 Linting and Formatting

```json
// .eslintrc.json
{
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier"
  ],
  "rules": {
    "no-console": "warn",
    "no-unused-vars": "error",
    "prefer-const": "error"
  }
}

// .prettierrc
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5"
}
```

### 7.2 Git Workflow

```bash
# Feature branches
git checkout -b feature/chat-system
git checkout -b fix/auth-bug
git checkout -b hotflow/security-patch

# Commit message format
feat: add chat message sending
fix: resolve authentication timeout
docs: update API documentation
refactor: optimize database queries
test: add unit tests for user service
```

### 7.3 Testing Standards

```javascript
// Example unit test
const request = require('supertest');
const app = require('../server');

describe('POST /api/messages', () => {
  it('should send a message successfully', async () => {
    const response = await request(app)
      .post('/api/messages')
      .set('Authorization', 'Bearer valid-token')
      .send({
        chatId: 'valid-chat-id',
        content: 'Hello'
      });
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('aiMessage');
  });
  
  it('should fail with insufficient credits', async () => {
    const response = await request(app)
      .post('/api/messages')
      .set('Authorization', 'Bearer no-credits-token')
      .send({
        chatId: 'valid-chat-id',
        content: 'Hello'
      });
    
    expect(response.status).toBe(402);
  });
});
```

---

## 8. Performance Optimization

### 8.1 Database Optimization

```javascript
// Connection pooling
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI, {
  maxPoolSize: 50,
  minPoolSize: 10,
  socketTimeoutMS: 45000,
  serverSelectionTimeoutMS: 5000
});

// Query optimization
const characters = await Character.find({ isPublic: true })
  .select('name description avatar usageCount') // Only needed fields
  .lean() // Returns plain JS objects
  .limit(20)
  .cache(60); // Cache for 60 seconds
```

### 8.2 API Response Caching

```javascript
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 600 }); // 10 minutes

const cachedResponse = (key, duration) => {
  return async (req, res, next) => {
    const cachedData = cache.get(key);
    if (cachedData) {
      return res.json(cachedData);
    }
    
    res.originalJson = res.json;
    res.json = function(data) {
      cache.set(key, data, duration);
      res.originalJson(data);
    };
    
    next();
  };
};

// Usage
app.get('/api/characters/public', cachedResponse('public_characters', 300), async (req, res) => {
  const characters = await Character.find({ isPublic: true });
  res.json(characters);
});
```

### 8.3 Frontend Optimization

```typescript
// Lazy loading routes
const ChatInterface = lazy(() => import('./pages/chat'));
const CharacterList = lazy(() => import('./pages/characters'));

// Image optimization
import Image from 'next/image';

<Image
  src={character.avatar}
  alt={character.name}
  width={100}
  height={100}
  loading="lazy"
/>

// Code splitting
const heavyComponent = dynamic(() => import('./HeavyComponent'), {
  loading: () => <LoadingSpinner />
});
```

---

## 9. Architettura delle Fasi di Test (Testing & Quality Assurance Framework)

Per garantire la stabilità del sistema, l'isolamento dei contesti delle chat, la sicurezza dei pagamenti e la resilienza sotto carico, la strategia di testing è suddivisa in 5 Fasi di Test integrate in tutto il ciclo di sviluppo.

### 9.1 Fase 1: Test Unitari (Unit Testing)
- **Framework**: Jest / Vitest
- **Scope**: Modelli di dati, utility di calcolo crediti/token, validazioni Zod.
- **Casi di Test Chiave**:
  1. `User.canSendMessage()`: verifica che un utente free con 0 crediti o un utente abbonato al limite giornaliero riceva `false`.
  2. `tokenUtils.estimateTokens()`: stima corretta dei token per messaggi lunghi.
  3. `Zod validation`: verifica del filtraggio di input malformati o tentativi di NoSQL injection su rotte di ricerca character.

### 9.2 Fase 2: Test di Integrazione e Mocking API (Integration Testing)
- **Framework**: Supertest + Nock / MSW (Mock Service Worker)
- **Scope**: Controller API Express, interazione con MongoDB Atlas e cache Redis.
- **Casi di Test Chiave**:
  1. **Isolamento Sessione Chat**: Invio di 5 messaggi simultanei da 2 utenti diversi per lo stesso Character pubblico. Verificare che le rispettive `Session` (chiavate su `chatId`) mantengano i contesti rigorosamente separati.
  2. **Gestione Fallimento Gemini API**: Simulare un errore 503/timeout da Google AI Studio. Verificare che l'API risponda con `504 Gateway Timeout` pulito senza scalzare crediti dall'utente.
  3. **Idempotenza Pagamenti Stripe**: Inviare due volte la stessa chiamata di creazione pagamento Stripe con la medesima `idempotencyKey`. Verificare che il DB registri una sola transazione e un solo incremento di crediti.

### 9.3 Fase 3: Test di Sicurezza e Moderazione (Security & Vulnerability Testing)
- **Strumenti**: OWASP ZAP, `npm audit`, Script Custom Prompt Injection
- **Scope**: Protezione da vulnerabilità Web (XSS, CSRF) e sicurezza degli LLM.
- **Casi di Test Chiave**:
  1. **Sanitizzazione Input XSS**: Inserimento di payload `<script>alert(1)</script>` o `javascript:` nei campi `personality` o `message.content`. Verificare l'escaping sia lato backend che frontend.
  2. **Prompt Injection / Jailbreak**: Testare prompt volti a bypassare le istruzioni del Character o ad estrarre il `systemPrompt` interno.
  3. **Verifica Webhook Signature**: Invio di payload webhook Stripe contraffatti senza firma HMAC valida per verificare il blocco immediato con HTTP 400.

### 9.4 Fase 4: Test di Concorrenza e Carico (Concurrency & Load Testing)
- **Strumenti**: k6 / Artillery
- **Scope**: Scalabilità dell'API Gateway, limiti del Connection Pool di MongoDB Atlas, performance Redis.
- **Target Metrici**:
  - 50 utenti concorrenti che inviano messaggi simultaneamente.
  - Latenza media API (esclusa chiamata Gemini): < 50ms.
  - Zero deadlock su transazioni MongoDB e zero saturazione delle connessioni (Pool Limit max 50).

### 9.5 Fase 5: Test End-to-End (E2E User Acceptance Testing)
- **Framework**: Playwright / Cypress
- **Scope**: Flusso utente completo dal browser.
- **Flusso E2E Validato**:
  1. Registrazione nuovo utente (con 10 crediti gratuiti).
  2. Creazione di un Character custom (Avatar, Personalità, Tag).
  3. Conversazione chat fino all'esaurimento dei crediti (ricezione modal "Crediti Esauriti").
  4. Acquisto simulato pacchetto crediti via Stripe Test Card (`4242...`).
  5. Richiesta generazione immagine (10 crediti detratti) e visualizzazione rendering in chat.

---

**Documento creato il 26 Agosto 2026**
**Versione: 1.2**
**Status: Complete & Verified**
