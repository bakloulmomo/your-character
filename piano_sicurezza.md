# Piano Sicurezza Completo - AI Character Chat App

## 1. Autenticazione e Gestione Account

### 1.1 Sicurezza Registrazione/Login

**Vulnerabilità Principali:**
- Credential stuffing (riuso password compromesse)
- Brute force attacks
- Account enumeration
- Session hijacking

**Soluzioni Implementative:**

```javascript
// Rate Limiting Login
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 5, // massimo 5 tentativi
  message: 'Troppi tentativi di login. Riprova tra 15 minuti.',
  skipSuccessfulRequests: true
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  // Login logic con verifica password
});
```

**Implementazione con Clerk:**
- Abilitare 2FA opzionale per utenti premium
- Email verification obbligatoria
- Password strength requirements (min 12 caratteri, maiuscole, numeri, simboli)
- Session tokens con breve scadenza (15 minuti per sessioni sensibili)

**Protezione Account Enumeration:**
```javascript
// Non rivelare se email esiste
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  // Sempre stessa risposta per evitare enumeration
  const user = await User.findOne({ email });
  if (!user || !await bcrypt.compare(password, user.password)) {
    // Simula delay per prevenire timing attacks
    await new Promise(resolve => setTimeout(resolve, 1000));
    return res.status(200).json({ 
      success: false, 
      message: 'Credenziali non valide' 
    });
  }
  
  // Procedi con login
});
```

### 1.2 Bannare Account Senza Bannare IP

**Problema:** Bannare IP blocca anche utenti legittimi (NAT, shared Wi-Fi)

**Soluzione: Device Fingerprinting + Account Ban**

```javascript
// Schema User con ban
const userSchema = new Schema({
  email: { type: String, required: true, unique: true },
  isBanned: { type: Boolean, default: false },
  banReason: String,
  banExpiresAt: Date,
  devices: [{
    deviceId: String, // Unique device fingerprint
    userAgent: String,
    lastSeen: Date,
    isTrusted: { type: Boolean, default: false }
  }]
});

// Middleware per check ban
const checkBan = async (req, res, next) => {
  const userId = req.user?.id;
  if (!userId) return next();
  
  const user = await User.findById(userId);
  if (user.isBanned) {
    // Check se ban è scaduto
    if (user.banExpiresAt && new Date() > user.banExpiresAt) {
      user.isBanned = false;
      user.banReason = null;
      await user.save();
      return next();
    }
    
    return res.status(403).json({ 
      error: 'Account sospeso',
      reason: user.banReason,
      expiresAt: user.banExpiresAt 
    });
  }
  
  next();
};
```

**Device Fingerprinting Implementation:**
```javascript
// Genera device ID unico
const generateDeviceId = (req) => {
  const fingerprint = [
    req.headers['user-agent'],
    req.headers['accept-language'],
    req.headers['accept-encoding'],
    req.ip
  ].join('|');
  
  return crypto.createHash('sha256').update(fingerprint).digest('hex');
};

// Endpoint per ban account (admin only)
app.post('/api/admin/ban-user', adminAuth, async (req, res) => {
  const { userId, reason, durationDays } = req.body;
  
  const user = await User.findById(userId);
  user.isBanned = true;
  user.banReason = reason;
  user.banExpiresAt = durationDays 
    ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000)
    : null;
  
  await user.save();
  
  // Revoca tutti i session tokens
  await clerkClient.sessions.invalidateUserSessions(userId);
  
  res.json({ success: true });
});
```

### 1.3 Gestione Sessioni e Cookies

**Vulnerabilità:**
- Session fixation
- Cookie theft via XSS
- CSRF attacks

**Soluzioni:**

```javascript
// Configurazione cookies sicuri
app.use(session({
  secret: process.env.SESSION_SECRET,
  cookie: {
    httpOnly: true, // Previene XSS access
    secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
    sameSite: 'strict', // Previene CSRF
    maxAge: 15 * 60 * 1000 // 15 minuti
  },
  rolling: true, // Rinnova session ad ogni request
  saveUninitialized: false,
  resave: false
}));

// CSRF Protection
const csrf = require('csurf');
const csrfProtection = csrf({ cookie: true });

app.post('/api/protected', csrfProtection, (req, res) => {
  // Endpoint protetto da CSRF
});
```

**Token Rotation:**
```javascript
// Rinnova access token periodicamente
app.use(async (req, res, next) => {
  if (req.user && req.path.startsWith('/api/')) {
    const lastTokenRotation = req.user.lastTokenRotation || 0;
    const now = Date.now();
    
    // Rinnova token ogni 30 minuti
    if (now - lastTokenRotation > 30 * 60 * 1000) {
      const newToken = jwt.sign(
        { userId: req.user.id }, 
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );
      
      req.user.lastTokenRotation = now;
      await req.user.save();
      
      res.setHeader('X-New-Token', newToken);
    }
  }
  next();
});
```

---

## 2. Vulnerabilità Web Principali

### 2.1 XSS (Cross-Site Scripting)

**Tipi di XSS:**
- Stored XSS (nel database)
- Reflected XSS (nei parametri URL)
- DOM-based XSS (lato client)

**Prevenzione:**

```javascript
// Server-side sanitization
const sanitizeHtml = require('sanitize-html');

app.post('/api/characters', async (req, res) => {
  const { name, description, personality } = req.body;
  
  // Sanitizza tutti gli input user-generated
  const sanitizedData = {
    name: sanitizeHtml(name, { allowedTags: [] }),
    description: sanitizeHtml(description, { 
      allowedTags: ['b', 'i', 'em', 'strong'],
      allowedAttributes: {} 
    }),
    personality: sanitizeHtml(personality, { allowedTags: [] })
  };
  
  const character = await Character.create(sanitizedData);
  res.json(character);
});

// Content Security Policy (CSP)
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "https://js.stripe.com"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
    connectSrc: ["'self'", "https://api.clerk.com", "https://generativelanguage.googleapis.com"]
  }
}));
```

**Client-side Protection (React):**
```jsx
// Usa sempre React's automatic escaping
function CharacterCard({ character }) {
  // ✅ CORRETTO - React escape automaticamente
  return <div>{character.name}</div>;
  
  // ❌ SBAGLIATO - Pericoloso
  return <div dangerouslySetInnerHTML={{ __html: character.name }} />;
}

// Per HTML necessario, sanitizza
import DOMPurify from 'dompurify';

function SafeHTML({ html }) {
  const clean = DOMPurify.sanitize(html);
  return <div dangerouslySetInnerHTML={{ __html: clean }} />;
}
```

### 2.2 SQL/NoSQL Injection

**Vulnerabilità MongoDB:**
```javascript
// ❌ VULNERABILE - NoSQL injection
app.get('/api/characters', async (req, res) => {
  const { name } = req.query;
  const characters = await Character.find({ name });
  // Se name = {$ne: null}, restituisce TUTTI i caratteri
});

// ✅ SICURO - Validazione input
const { name } = req.query;
if (!name || typeof name !== 'string' || name.length > 50) {
  return res.status(400).json({ error: 'Invalid name parameter' });
}

const characters = await Character.find({ 
  name: { $regex: `^${escapeRegex(name)}`, $options: 'i' }
});

// Funzione escape regex
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

**Validazione Schema con Mongoose:**
```javascript
const characterSchema = new Schema({
  name: {
    type: String,
    required: true,
    minlength: 2,
    maxlength: 50,
    trim: true,
    validate: {
      validator: function(v) {
        return /^[a-zA-Z0-9\s\-']+$/.test(v);
      },
      message: 'Nome contiene caratteri non validi'
    }
  },
  // ... altri campi
});

// Pre-save hook per sanitizzazione
characterSchema.pre('save', function(next) {
  this.name = this.name.trim();
  this.description = this.description.trim();
  next();
});
```

### 2.3 CSRF (Cross-Site Request Forgery)

**Implementazione:**
```javascript
const csrf = require('csurf');
const cookieParser = require('cookie-parser');

app.use(cookieParser());
const csrfProtection = csrf({ 
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  }
});

// Genera token per frontend
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Proteggi endpoints mutanti
app.post('/api/characters', csrfProtection, async (req, res) => {
  // Crea character
});

// React integration
import axios from 'axios';

// Ottieni CSRF token
const { data } = await axios.get('/api/csrf-token');

// Includi in headers
axios.post('/api/characters', characterData, {
  headers: {
    'X-CSRF-Token': data.csrfToken
  }
});
```

---

## 3. Sicurezza Database

### 3.1 MongoDB Security Best Practices

**Configurazione Atlas:**
```javascript
// Connection string sicura
const MONGODB_URI = process.env.MONGODB_URI;

// Opzioni connessione
const client = new MongoClient(MONGODB_URI, {
  tls: true, // SSL/TLS obbligatorio
  retryWrites: true,
  w: 'majority', // Write concern majority
  readPreference: 'primary',
  maxPoolSize: 50,
  minPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000
});
```

**Database User Permissions:**
```javascript
// Non usare MAI admin user in app
// Crea user con permessi minimi

// User per app (readWrite su database specifico)
{
  username: "app_user",
  password: process.env.MONGODB_APP_PASSWORD,
  roles: [
    { role: "readWrite", db: "your_character_db" }
  ]
}

// User per backup (read only)
{
  username: "backup_user",
  password: process.env.MONGODB_BACKUP_PASSWORD,
  roles: [
    { role: "read", db: "your_character_db" }
  ]
}
```

**Encryption at Rest:**
- Abilitare MongoDB Atlas encryption
- Usare AWS KMS o Azure Key Vault per key management
- Rotazione chiavi ogni 90 giorni

**Field-Level Encryption:**
- MongoDB Atlas M0 ha encryption at rest integrato
- Per MVP non serve field-level encryption custom
- Implementare solo quando scale a M10+ per dati ultra-sensibili

### 3.2 Backup e Recovery

**MongoDB Atlas Backup Strategy:**
```javascript
// Configurazione backup Atlas
// 1. Continuous Backup (opzionale per M0, obbligatorio per M10+)
// 2. Snapshot giornalieri
// 3. Retention policy: 7 giorni per dev, 30 giorni per prod

// Script backup manuale (per emergenze)
const { exec } = require('child_process');

async function backupDatabase() {
  const timestamp = new Date().toISOString();
  const backupCmd = `mongodump --uri="${process.env.MONGODB_URI}" \
    --archive=backup-${timestamp}.gz --gzip`;
  
  exec(backupCmd, (error, stdout, stderr) => {
    if (error) {
      console.error(`Backup error: ${error}`);
      return;
    }
    console.log('Backup completed successfully');
    
    // Upload a S3 per offsite backup
    uploadToS3(`backup-${timestamp}.gz`);
  });
}

// Schedule backup giornaliero
const cron = require('node-cron');
cron.schedule('0 2 * * *', backupDatabase); // 2 AM ogni giorno
```

### 3.3 Query Optimization per Performance e Sicurezza

**Index Strategy:**
```javascript
// Indici per query comuni
characterSchema.index({ name: 1, createdBy: 1 });
characterSchema.index({ isPublic: 1, createdAt: -1 });
userSchema.index({ email: 1 }); // Già unique
messageSchema.index({ chatId: 1, createdAt: -1 });

// Indici compound per query complesse
messageSchema.index({ 
  chatId: 1, 
  createdAt: -1 
}, { 
  name: 'chat_messages_index' 
});
```

**Query Limits per prevenire DoS:**
```javascript
// Limita sempre risultati query
app.get('/api/characters', async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  
  // Valida limit
  const maxLimit = 100;
  const validLimit = Math.min(limit, maxLimit);
  
  const characters = await Character.find()
    .limit(validLimit)
    .skip((page - 1) * validLimit)
    .lean();
  
  res.json(characters);
});
```

---

## 4. Sicurezza Pagamenti

### 4.1 Prevenzione Double Payment

**Problema:** Utente clicca 2 volte "paga" → viene addebitato 2 volte

**Soluzione 1: Idempotency Keys (Stripe)**
```javascript
app.post('/api/purchase-credits', async (req, res) => {
  const { amount, credits } = req.body;
  const userId = req.user.id;
  
  // Genera idempotency key unica
  const idempotencyKey = `purchase_${userId}_${Date.now()}`;
  
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100, // in cents
      currency: 'eur',
      metadata: {
        userId,
        credits,
        idempotencyKey
      },
      idempotencyKey // Stripe garantisce una sola esecuzione
    });
    
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    if (error.type === 'IdempotencyError') {
      // Recupera payment intent esistente
      const existingPayment = await stripe.paymentIntents.retrieve({
        idempotencyKey
      });
      return res.json({ clientSecret: existingPayment.client_secret });
    }
    res.status(500).json({ error: error.message });
  }
});
```

**Soluzione 2: Database Transaction Lock**
```javascript
const mongoose = require('mongoose');

app.post('/api/purchase-credits', async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    await session.withTransaction(async () => {
      const userId = req.user.id;
      const { credits } = req.body;
      
      // Lock user document
      const user = await User.findById(userId).session(session);
      
      // Check se c'è pending transaction
      const pendingTransaction = await Transaction.findOne({
        userId,
        status: 'pending',
        createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // 5 min fa
      }).session(session);
      
      if (pendingTransaction) {
        throw new Error('Transazione in corso');
      }
      
      // Crea transaction record
      const transaction = await Transaction.create([{
        userId,
        credits,
        amount: req.body.amount,
        status: 'pending',
        idempotencyKey: req.body.idempotencyKey
      }], { session });
      
      // Processa pagamento Stripe
      const paymentIntent = await stripe.paymentIntents.create({
        amount: req.body.amount * 100,
        currency: 'eur',
        metadata: { transactionId: transaction[0]._id }
      });
      
      res.json({ clientSecret: paymentIntent.client_secret });
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    await session.endSession();
  }
});
```

### 4.2 Webhook Security

**Verifica Signature Stripe:**
```javascript
const crypto = require('crypto');

app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
   console.log(`Webhook signature verification failed.`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  // Processa evento
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      await handleSuccessfulPayment(paymentIntent);
      break;
    case 'payment_intent.payment_failed':
      await handleFailedPayment(event.data.object);
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }
  
  res.json({ received: true });
});

async function handleSuccessfulPayment(paymentIntent) {
  const { userId, credits } = paymentIntent.metadata;
  
  const user = await User.findById(userId);
  user.credits += parseInt(credits);
  await user.save();
  
  await Transaction.findOneAndUpdate(
    { stripePaymentIntentId: paymentIntent.id },
    { status: 'completed' }
  );
}
```

### 4.3 PCI Compliance

**Protezione Dati Carta:**
```javascript
// ❌ MAI salvare dati carta nel database
// ❌ MAI loggare dati carta
// ❌ MAI passare dati carta via URL parameters

// ✅ Usa Stripe Elements per PCI compliance
// Stripe gestisce tutto il flusso PCI-DSS

// Frontend con Stripe Elements
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement } from '@stripe/react-stripe-js';

const stripe = loadStripe(process.env.NEXT_PUBLIC_STRIPE_KEY);

function PaymentForm() {
  const handleSubmit = async (event) => {
    event.preventDefault();
    
    const { error, paymentMethod } = await stripe.createPaymentMethod({
      type: 'card',
      card: elements.getElement(CardElement),
    });
    
    if (error) {
      console.log(error);
    } else {
      // Invia solo paymentMethod.id al backend
      // MAI dati carta completi
      const response = await fetch('/api/purchase-credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          paymentMethodId: paymentMethod.id,
          amount: 10,
          credits: 100
        })
      });
    }
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <CardElement />
      <button type="submit">Paga</button>
    </form>
  );
}
```

---

## 5. Protezione DDOS e Rate Limiting

### 5.1 Multi-Layer Rate Limiting

**Layer 1: Platform-level (Render.com)**
- Render ha rate limiting built-in su free tier
- Per MVP non serve Cloudflare (costo aggiuntivo)
- Aggiungere Cloudflare solo quando scale > 1,000 utenti

**Layer 2: Application-level (Express)**
```javascript
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL);

// Limite generico per tutte le API
const generalLimiter = rateLimit({
  store: new RedisStore({ client: redis }),
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 1000, // 1000 request per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests'
});

// Limite specifico per API costose
const expensiveApiLimiter = rateLimit({
  store: new RedisStore({ client: redis }),
  windowMs: 60 * 1000, // 1 minuto
  max: 10, // 10 request al minuto
  message: 'API rate limit exceeded'
});

app.use('/api/', generalLimiter);
app.use('/api/generate-image', expensiveApiLimiter);
app.use('/api/chat', expensiveApiLimiter);
```

**Layer 3: User-based (per account)**
```javascript
// Limite per utente autenticato
const userLimiter = async (req, res, next) => {
  if (!req.user) return next();
  
  const key = `user_limit_${req.user.id}`;
  const requests = await redis.incr(key);
  
  if (requests === 1) {
    await redis.expire(key, 60); // Scade dopo 60 secondi
  }
  
  if (requests > 100) { // 100 request/min per utente
    return res.status(429).json({ error: 'User rate limit exceeded' });
  }
  
  next();
};

app.use('/api/', userLimiter);
```

### 5.2 Request Validation and Filtering

**Blocco Request Sospette:**
```javascript
const suspiciousRequestCheck = (req, res, next) => {
  // Blocca user-agent sospetti
  const suspiciousUserAgents = [
    /bot/i,
    /crawler/i,
    /spider/i,
    /curl/i,
    /wget/i
  ];
  
  const userAgent = req.headers['user-agent'] || '';
  if (suspiciousUserAgents.some(pattern => pattern.test(userAgent))) {
    return res.status(403).json({ error: 'Bot detected' });
  }
  
  // Blocca request senza referer per API sensibili
  if (req.path.startsWith('/api/') && !req.headers.referer) {
    return res.status(403).json({ error: 'Invalid request' });
  }
  
  // Blocca request con header anomali
  if (req.headers['x-forwarded-for'] && req.headers['x-forwarded-for'].split(',').length > 5) {
    return res.status(403).json({ error: 'Proxy detected' });
  }
  
  next();
};

app.use(suspiciousRequestCheck);
```

### 5.3 Graceful Degradation (MVP)

```javascript
// Per MVP: semplice retry con timeout
async function callGeminiWithRetry(context, maxRetries = 2) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await geminiService.generateResponse(context);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

// Circuit breaker aggiungere quando scale > 1,000 utenti
```

---

## 6. Logging e Monitoring Sicurezza

### 6.1 Security Event Logging

```javascript
const securityLogger = {
  logLoginAttempt: (userId, ip, success) => {
    SecurityEvent.create({
      type: 'LOGIN_ATTEMPT',
      userId,
      ip,
      success,
      timestamp: new Date(),
      userAgent: req.headers['user-agent']
    });
  },
  
  logSuspiciousActivity: (userId, activity) => {
    SecurityEvent.create({
      type: 'SUSPICIOUS_ACTIVITY',
      userId,
      activity,
      timestamp: new Date(),
      ip: req.ip
    });
    
    // Alert immediato per attività sospetta
    if (activity === 'multiple_failed_logins') {
      sendSecurityAlert(userId, 'Multiple failed login attempts detected');
    }
  },
  
  logAdminAction: (adminId, action, target) => {
    SecurityEvent.create({
      type: 'ADMIN_ACTION',
      userId: adminId,
      action,
      target,
      timestamp: new Date()
    });
  }
};

// Implementazione in login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip;
  
  const user = await User.findOne({ email });
  
  if (!user || !await bcrypt.compare(password, user.password)) {
    securityLogger.logLoginAttempt(user?.id, ip, false);
    
    // Check per brute force
    const recentFailures = await SecurityEvent.countDocuments({
      type: 'LOGIN_ATTEMPT',
      success: false,
      ip,
      timestamp: { $gte: new Date(Date.now() - 15 * 60 * 1000) }
    });
    
    if (recentFailures >= 5) {
      securityLogger.logSuspiciousActivity(user?.id, 'multiple_failed_logins');
      return res.status(429).json({ error: 'Too many failed attempts' });
    }
    
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  securityLogger.logLoginAttempt(user.id, ip, true);
  // Procedi con login
});
```

### 6.2 Real-time Monitoring con Sentry

```javascript
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
  beforeSend(event, hint) {
    // Filtra dati sensibili
    if (event.request) {
      delete event.request.headers;
      delete event.request.cookies;
    }
    return event;
  }
});

// Custom security alerts
Sentry.captureMessage('Suspicious activity detected', {
  level: 'warning',
  extra: {
    userId: req.user.id,
    ip: req.ip,
    activity: 'unusual_api_usage'
  }
});
```

---

## 7. Checklist Sicurezza Pre-Launch

### Pre-Deployment Checklist

**Autenticazione:**
- [ ] Rate limiting login implementato
- [ ] 2FA opzionale configurato
- [ ] Password strength requirements attivi
- [ ] Session timeout configurato
- [ ] Token rotation implementato
- [ ] Account ban system testato

**Web Security:**
- [ ] CSP headers configurati
- [ ] XSS sanitization su tutti gli input
- [ ] CSRF protection attivo
- [ ] Helmet middleware configurato
- [ ] CORS configurato correttamente
- [ ] Input validation su tutti gli endpoint

**Database Security:**
- [ ] TLS/SSL obbligatorio
- [ ] User permissions minimi
- [ ] Field encryption per dati sensibili
- [ ] Backup automatici configurati
- [ ] Query limits implementati
- [ ] Indici ottimizzati

**Payment Security:**
- [ ] Stripe idempotency keys
- [ ] Webhook signature verification
- [ ] PCI compliance (Stripe Elements)
- [ ] Transaction logging
- [ ] Double payment prevention testato

**DDOS Protection:**
- [ ] Cloudflare configurato
- [ ] Multi-layer rate limiting
- [ ] Request validation
- [ ] Circuit breaker pattern
- [ ] Redis per distributed limiting

**Monitoring:**
- [ ] Sentry error tracking
- [ ] Security event logging
- [ ] Real-time alerts configurati
- [ ] Performance monitoring
- [ ] Uptime monitoring

### Penetration Testing Plan (POST-LAUNCH)

**Quando fare:** Dopo 1,000+ utenti o prima di Series A

**Fase 1: Automated Scanning**
- OWASP ZAP basic scan
- SSL Labs test
- Dependency vulnerability scan (npm audit)

**Fase 2: Manual Testing**
- Test brute force login
- Test XSS su form principali
- Test rate limiting bypass
- Test session hijacking

**Fase 3: Third-party Audit**
- Considerare audit professionale quando scale > 10,000 utenti
- Bug bounty program quando revenue > $10,000/mese

---

## 8. Incident Response Plan

### Security Incident Procedure (SEMPLIFICATO MVP)

**Step 1: Identification (15 min)**
- Monitor alert da Sentry
- Identifica tipo di problema

**Step 2: Containment (30 min)**
- Disabilita feature problematica
- Revoca session tokens se necessario

**Step 3: Recovery (1 ora)**
- Patch o rollback
- Test sistema
- Riattiva feature

**Step 4: Post-Incident (24 ore)**
- Documenta incidente
- Aggiorna procedure se necessario

### Communication Template

**Per utenti colpiti (se necessario):**
```
Stiamo risolvendo un problema tecnico. 
Potresti riscontrare interruzioni temporanee.

Grazie per la pazienza.
Team
```

---

**Documento creato il 26 Agosto 2026**
**Versione: 1.0**
**Status: Ready for Implementation**
