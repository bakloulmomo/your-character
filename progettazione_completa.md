# Documento di Progettazione - AI Character Chat App

## 1. Analisi Finanziaria e Unit Economics (Stress Test dei Prezzi)

### Costo API Gemini Flash vs Prezzi Proposti

**Prezzi Gemini 2.5 Flash (2026):**
- Input: $0.30 per 1M token
- Output: $2.50 per 1M token
- Costo medio stimato per messaggio: $0.003 - $0.008 (basato su 500-1,500 token totali per messaggio)

**Analisi del tuo pricing:**
- Pacchetto 100 crediti: $3.99 = $0.0399 per messaggio
- Costo API stimato: $0.003 - $0.008 per messaggio
- **Margine lordo: 80-92%** ✅ **OTTIMO**

**Problema critico identificato:** Il tuo prezzo è troppo alto rispetto al mercato. Character.ai offre chat illimitate a $9.99/mensili, mentre tu chiedi $3.99 per solo 100 messaggi.

**Raccomandazione:**
- **Ridurre il prezzo a $1.99 per 100 messaggi** (margine ancora 60-75%)
- Oppure mantenere $3.99 ma offrire 300 messaggi (margine 40-60%)
- Considerare un modello ibrido: abbonamento mensile con messaggi inclusi

### Generazione Immagini - Provider e Margini

**Opzioni analizzate:**

1. **Stability AI API (Stable Diffusion 3.5 Flash)**
   - Costo: $0.025 per immagine (2.5 crediti)
   - Tuo prezzo: 10 crediti = $0.10
   - **Margine: 75%** ✅

2. **Stable Image Core (alternativa più economica)**
   - Costo: $0.03 per immagine
   - Tuo prezzo: $0.10
   - **Margine: 70%** ✅

**Raccomandazione:** Usa **Stable Diffusion 3.5 Flash** via Stability AI API. È il miglior equilibrio qualità/prezzo e il tuo margine del 75% è eccellente.

### Calcolo Range Limit per Abbonamento $6.99

**Costi base per utente attivo/giorno:**
- Messaggi medi: 20 (input 500 + output 500 token) = $0.06
- Immagini: 2 = $0.05
- **Totale costo/giorno: $0.11**

**Analisi abbonamento $6.99/mese:**
- Budget mensile: $6.99
- Costo/giorno sostenibile: $0.23
- **Range limite consigliato: 40 messaggi + 5 immagini/giorno**

**Percezione "illimitato":**
- 40 messaggi/giorno = 1,200/mese (sufficiente per 99% utenti)
- 5 immagini/giorno = 150/mese (generoso per uso normale)
- **Margine di sicurezza: 50%** (costo reale ~$3.50/mese)

**Raccomandazione:** Imposta hard limit a 50 messaggi + 8 immagini/giorno, ma mostra "illimitato" nell'UI. Solo il top 1% degli utenti lo raggiungerà.

---

## 2. Posizionamento e Strategia di Marketing (Go-To-Market)

### Buyer Personas Principali

**Persona 1: The Creative Writer (35%)**
- **Demografica:** 18-35 anni, studenti universitari, scrittori amatoriali
- **Pain points:** Writer's block, bisogno di ispirazione, testing dialoghi
- **Motivazione:** Creare storie interattive, sviluppare personaggi
- **Canali preferiti:** Reddit (r/writing, r/charactercreation), Discord communities, Twitter writing circles
- **Feature chiave:** Personalizzazione profonda personaggi, coerenza narrativa

**Persona 2: The Roleplayer (40%)**
- **Demografica:** 16-28 anni, fan anime/gaming, D&D players
- **Pain points:** Limitazioni filtri NSFW su competitor, costi elevati
- **Motivazione:** Escape dalla realtà, esplorazione fantasie, social roleplay
- **Canali preferiti:** TikTok (#roleplay, #ai), Instagram, Discord RP servers
- **Feature chiave:** Personaggi pubblici condivisibili, filtri personalizzabili

**Persona 3: The Lonely Professional (25%)**
- **Demografica:** 25-45 anni, lavoratori remote, introvertiti
- **Pain points:** Solitudine, stress lavoro, bisogno di conversazioni non giudicanti
- **Motivazione:** Supporto emotivo, pratica conversazionale, compagnia
- **Canali preferiti:** LinkedIn (gruppi mental health), Facebook groups, Reddit (r/lonely)
- **Feature chiave:** Personaggi privati, modalità "mentore/coach", privacy

### Strategia Acquisizione Primi 1,000 Utenti

**Fase 1: Reddit Guerrilla (Giorni 1-15)**
- Target: r/CharacterAI, r/artificial, r/Roleplay, r/writing
- Tattica: Condividere personaggi creativi unici, chiedere feedback
- Budget: $0 (organico)
- Obiettivo: 200 utenti

**Fase 2: TikTok Content (Giorni 1-30)**
- Contenuti: "Conversazioni assurde con AI", "Ho creato il mio personaggio anime preferito"
- Hashtag: #AI #CharacterAI #Roleplay #ChatGPT
- Frequenza: 2 video/giorno
- Budget: $100 (boost post performanti)
- Obiettivo: 500 utenti

**Fase 3: SEO Long-Tail (Giorni 15-30)**
- Keywords: "AI character creator free", "NSFW AI chat alternative", "custom AI personality"
- Strategia: Landing page ottimizzata, blog post con tutorial
- Budget: $50 (dominio + hosting)
- Obiettivo: 300 utenti

**Metriche di successo:**
- CAC (Costo Acquisizione Cliente) target: <$2
- Conversione free → paid: 5-8%
- Retention Day 7: >40%

### Analisi Competitiva e Value Proposition

**Competitor Principali:**

| Feature | Character.ai | Replika | La Tua App |
|---------|--------------|---------|------------|
| Prezzo | $9.99/mo | $19.99/mo | $3.99/100 msg |
| Filtri NSFW | Rigidi | Rimossi (2023) | Personalizzabili |
| Creazione Personaggi | Limitata | Limitata | Completamente custom |
| Personaggi Pubblici | 10M+ | No | Sì (marketplace) |
| Privacy | Base | Base | Personaggi privati |
| API Access | No | No | Sì (roadmap) |

**Tua Value Proposition:**
1. **"Create Your Own Universe"** - Personalizzazione senza precedenti
2. **"Freedom to Chat"** - Filtri personalizzabili per utente
3. **"Pay As You Go"** - No abbonamento obbligatorio
4. **"Private & Public"** - Scegli cosa condividere

**Differenziazione chiave:**
- Character.ai: troppo filtri, no personalizzazione profonda
- Replika: troppo costoso, focus solo su 1 companion
- Tu: Flessibilità totale, pricing modulare, marketplace personaggi

---

## 3. Espansione Tecnica e Sicurezza dell'MVP

### Strumenti Tecnici Aggiuntivi Necessari

**Autenticazione & User Management:**
- **Clerk** (raccomandato) o Firebase Auth
- Costo: Free fino a 5,000 MAU, poi $0.02/MAU
- Vantaggi: Social login (Google, Discord), gestione sessioni, UI pre-built

**Pagamenti:**
- **Stripe** (obbligatorio)
- Costo: 2.9% + $0.30 per transazione
- Vantaggi: Supporto internazionale, webhook, subscription management

**Storage Immagini:**
- **Cloudinary** (raccomandato) o AWS S3
- Costo: Free tier 25GB/mese, poi $0.015/GB
- Vantaggi: Auto-optimization, CDN integrato, transformations on-the-fly

**Monitoring & Analytics:**
- **Sentry** per error tracking
- **Mixpanel** o PostHog per user analytics
- Costo: Free tier sufficienti per MVP

**Rate Limiting:**
- **Upstash Redis** per rate limiting distribuito
- Costo: Free tier 10,000 commands/day
- Necessario per prevenire abusi crediti

**Email Service:**
- **Resend** o SendGrid
- Costo: Free tier 3,000 emails/mese
- Per: welcome emails, receipt, password reset

### Gestione Contesto Chat (Token Management)

**Problema:** Chat lunghe sforano limiti token e aumentano costi API

**Soluzione Architetturale:**

```
1. Context Window Strategy
   - Mantieni ultimi 20 messaggi in memoria calda
   - Archivia messaggi più vecchi in MongoDB
   - Summarization ogni 50 messaggi

2. Token Estimation Pre-Request
   - Conta token prima di chiamare API
   - Se > 80% context window: trigger summarization
   - Se > 95%: trim messaggi più vecchi

3. Hierarchical Context
   - System prompt: fisso (personality)
   - Short-term: ultimi 20 messaggi
   - Medium-term: summary ultimi 100 messaggi
   - Long-term: key facts estratti (nome, preferenze, eventi)

4. Cost Optimization
   - Usa context caching di Gemini ($0.03/M cached vs $0.30/M)
   - Cache system prompt e character definition
   - Batch processing per multi-utente
```

**Implementazione Tecnica:**
```javascript
// Pseudo-codice per context management
async function buildContext(chatId, characterId) {
  const systemPrompt = await getCharacterSystemPrompt(characterId);
  const recentMessages = await getRecentMessages(chatId, 20);
  const conversationSummary = await getConversationSummary(chatId);
  const keyFacts = await extractKeyFacts(chatId);
  
  const context = [
    systemPrompt,
    conversationSummary,
    keyFacts,
    ...recentMessages
  ];
  
  const tokenCount = estimateTokens(context);
  if (tokenCount > MAX_TOKENS * 0.8) {
    await summarizeOldMessages(chatId);
    return buildContext(chatId, characterId); // retry
  }
  
  return context;
}
```

### Sicurezza e Privacy

**Autenticazione:**
- JWT tokens con refresh rotation
- Rate limiting su login (5 tentativi/15min)
- 2FA opzionale per account premium

**Data Protection:**
- Encryption at rest (MongoDB encryption)
- HTTPS obbligatorio
- Sanitizzazione input per prevenire injection
- CORS configurato correttamente

**API Security:**
- API keys rotate mensilmente
- Webhook signature verification (Stripe)
- Environment variables per secrets (never in code)

**Content Moderation:**
- Filtro base per contenuti illegali
- Sistema reporting utenti
- Opzione "safe mode" per utenti sensibili

---

## 4. Roadmap Primi 30 Giorni

### Settimana 1: Foundation (Giorni 1-7)

**Giorno 1-2: Setup & Planning**
- [ ] Setup repository Git (GitHub)
- [ ] Configurare ambiente sviluppo (Node.js, React)
- [ ] Creare account servizi terzi (Stripe, Clerk, Cloudinary, MongoDB Atlas)
- [ ] Definire schema database (Users, Characters, Chats, Messages, Credits)
- [ ] Setup progetto React con Vite
- [ ] Setup progetto Node.js con Express

**Giorno 3-4: Database & Auth**
- [ ] Implementare MongoDB connection
- [ ] Creare Mongoose models (User, Character, Chat, Message, CreditTransaction)
- [ ] Integrare Clerk per autenticazione
- [ ] Creare middleware per protezione rotte
- [ ] Implementare user profile CRUD

**Giorno 5-7: Core Chat Infrastructure**
- [ ] Creare API endpoint per character creation
- [ ] Implementare basic chat API (send/receive messages)
- [ ] Integrare Gemini Flash API
- [ ] Creare frontend chat interface base
- [ ] Implementare real-time con Socket.io (opzionale per MVP)

### Settimana 2: Core Features (Giorni 8-14)

**Giorno 8-10: Character System**
- [ ] Implementare character creation form
- [ ] Aggiungere campi: name, personality, backstory, avatar
- [ ] Creare character library (pubblico/privato)
- [ ] Implementare character search/filter
- [ ] Upload avatar con Cloudinary

**Giorno 11-12: Credit System**
- [ ] Implementare credit system database
- [ ] Creare API per credit balance
- [ ] Integrare Stripe per payments
- [ ] Implementare webhook Stripe per credit updates
- [ ] Creare pricing page UI

**Giorno 13-14: Image Generation**
- [ ] Integrare Stability AI API
- [ ] Creare endpoint per image generation
- [ ] Implementare deduzione crediti per immagini
- [ ] Aggiungere UI per request immagini in chat
- [ ] Display immagini in chat history

### Settimana 3: Polish & Context Management (Giorni 15-21)

**Giorno 15-17: Context Management**
- [ ] Implementare token estimation
- [ ] Creare message summarization logic
- [ ] Implementare context window management
- [ ] Aggiungere key facts extraction
- [ ] Test con chat lunghe (100+ messaggi)

**Giorno 18-19: UI/UX Improvements**
- [ ] Design responsive mobile layout
- [ ] Aggiungere dark mode
- [ ] Implementare loading states
- [ ] Creare character selection screen
- [ ] Aggiungere chat history navigation

**Giorno 20-21: Testing & Bug Fixes**
- [ ] Unit test per API core
- [ ] Integration test per Stripe
- [ ] Manual testing complete user flow
- [ ] Fix critical bugs
- [ ] Performance optimization

### Settimana 4: Launch Preparation (Giorni 22-30)

**Giorno 22-24: Marketing Assets**
- [ ] Creare landing page
- [ ] Scrivere copy per value proposition
- [ ] Creare demo video (30 secondi)
- [ ] Setup Google Analytics
- [ ] Creare social media accounts

**Giorno 25-26: Deployment**
- [ ] Setup Vercel per frontend
- [ ] Setup Railway/Render per backend
- [ ] Configurare environment variables
- [ ] Setup custom domain
- [ ] SSL certificate configuration

**Giorno 27-28: Beta Testing**
- [ ] Invita 20 beta tester (amici/Reddit)
- [ ] Raccogli feedback prioritari
- [ ] Fix bug critici
- [ ] Aggiusta pricing se necessario

**Giorno 29-30: Launch**
- [ ] Soft launch su Product Hunt
- [ ] Post su Reddit (r/CharacterAI, r/artificial)
- [ ] Primi TikTok content
- [ ] Monitoraggio errori in tempo reale
- [ ] Setup customer support (Discord)

### Metriche da Tracciare dal Day 1

**Technical Metrics:**
- API response time (target: <2s)
- Error rate (target: <1%)
- Uptime (target: >99.5%)
- Cost API per utente (target: <$0.10/mese)

**Business Metrics:**
- Daily Active Users (DAU)
- Messages per user per day
- Credit purchase conversion rate
- Churn rate Day 7, Day 30
- Average revenue per user (ARPU)

### Budget Primi 30 Giorni

| Voce | Costo |
|------|-------|
| Hosting (Vercel + Railway) | $0 (free tier) |
| MongoDB Atlas | $0 (free tier) |
| Cloudinary | $0 (free tier) |
| Clerk Auth | $0 (free tier) |
| Domain | $12 |
| Stripe fees (testing) | $0 |
| API testing (Gemini + Stability) | $20 |
| Marketing boost | $100 |
| **Totale** | **$132** |

---

## Conclusioni e Raccomandazioni Finali

### Critiche Costruttive alla Tua Idea Iniziale

**Problemi identificati:**
1. **Pricing troppo aggressivo** - $3.99/100 messaggi è 4x più caro di Character.ai
2. **Mancanza di differentiation chiara** - Perché un utente sceglierebbe te invece di Character.ai?
3. **Modello crediti complesso** - Gli utenti preferiscono abbonamenti semplici

**Raccomandazioni correttive:**
1. **Ridurre pricing a $1.99/100 messaggi** oppure **$4.99/300 messaggi**
2. **Posizionarsi su "NSFW-friendly"** (con filtri personalizzabili) - questo è il tuo vero vantaggio competitivo
3. **Mantenere modello abbonamento** ma renderlo più competitivo: $4.99/mo per 50 messaggi/giorno

### Tua Killer Feature: "Freedom of Expression"

Character.ai e Replika hanno filtri molto rigidi. Se tu offri:
- Filtri personalizzabili per utente
- Opzione "safe mode" vs "uncensored mode"
- Personaggi privati 100% privati

Hai un mercato enorme di utenti insoddisfatti dei competitor.

### Next Step Immediato

**Inizia con MVP minimale:**
1. Solo chat testo (niente immagini per ora)
2. Solo personaggi privati (niente marketplace pubblico)
3. Pricing semplice: 10 messaggi free, poi $0.02 per messaggio

Questo ti permette di:
- Lanciare in 2 settimane invece di 4
- Testare il mercato con rischio minimo
- Iterare rapidamente base a feedback

**Successivamente aggiungi:**
- Immagini (quando hai utenti paganti)
- Marketplace pubblico (quando hai 1,000+ utenti)
- App mobile (quando hai 10,000+ utenti)

---

## Documenti di Approfondimento

Per una progettazione completa e dettagliata, consulta i seguenti documenti specialistici:

### 📋 [Piano Sicurezza Completo](./piano_sicurezza.md)
- Vulnerabilità web (XSS, SQL injection, CSRF)
- Sicurezza autenticazione e gestione account
- Bannare account senza bloccare IP
- Protezione DDOS e rate limiting
- Sicurezza pagamenti (double payment prevention)
- Incident response plan

### 🏗️ [Piano Architettura e Implementazione](./piano_architettura.md)
- Architettura sistema completa (diagrammi)
- Database schema dettagliato (Mongoose)
- API structure e implementazione
- Service layer (Gemini, Context Manager, Image Generation)
- Frontend architecture (React, Zustand)
- Implementation roadmap (8 settimane)
- Code quality standards

### 💰 [Piano Finanziario Completo](./piano_finanziario.md)
- Costi produzione per scala (MVP → Scale)
- Modello revenue e pricing strategy
- Proiezioni finanziarie 12 mesi
- Strategia marketing e Go-To-Market
- Unit economics e break-even analysis
- Budget dettagliato e cash flow
- KPIs e metriche di successo

### 🔍 Visualizzazione Utenti Registrati

È possibile monitorare gli utenti registrati attraverso diversi metodi:

**Via Codice (Backend API):**
```javascript
// Endpoint statistiche
GET /api/admin/stats
Response: {
  totalUsers: 150,
  activeUsers: 45,
  newUsersToday: 12,
  premiumUsers: 8
}
```

**Via Database (MongoDB):**
```javascript
db.users.countDocuments({}) // Totale utenti
db.users.countDocuments({createdAt: {$gte: new Date().setHours(0,0,0,0)}}) // Utenti oggi
```

**Via Dashboard Admin:**
- Pagina `/admin` con statistiche real-time
- Grafici attivi/passivi, conversioni, revenue
- Tracking eventi via Mixpanel/PostHog

---

**Documento creato il 26 Agosto 2026**
**Versione: 1.1**
**Status: Ready for Implementation**
**Documenti correlati:** piano_sicurezza.md, piano_architettura.md, piano_finanziario.md
