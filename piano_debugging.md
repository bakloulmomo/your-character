# Piano di Debugging & Remediation — your-character

> Documento operativo redatto dal reparto QA. Mappa ogni bug a una fase di sviluppo.
> **Da usare SOLO in fase di implementazione (dopo l'approvazione).** Ordine per dipendenza + severità.
> Legenda ID: **C**=Critico/Blocker · **A**=Alto · **U**=UX/Medio · **L**=Basso/Polish.

---

## ✅ Stato avanzamento (aggiornato)

- **FASE 0 — COMPLETATA e verificata a runtime** (MongoDB reale + probe end-to-end):
  - **C1** connessione DB, **C2** webhook con firma obbligatoria, **C3** modello `gemini-2.5-flash`, **C4** seed con ID deterministici. Ogni personaggio in galleria è ora chattabile; webhook forgiato (secret reale) → HTTP 400.
- **FASE 1 — COMPLETATA e verificata** (backend + client, 39/39 test verdi):
  - **A1** `/payments/confirm` server-side + client (niente accredito finto), **A2** backdoor solo in `test`, **A3** deduzione crediti atomica/non-negativa, **A4** reset giornaliero (nuovo test), **A5** `await updateSession`, **A6** flag `error` sui messaggi (no match testuale), **A7** 402 → apre modal ricarica, **A8** gate 18+ (client+server). Typo L3 corretto in corso d'opera.
- **FASE 2 — IN CORSO**:
  - ✅ **Abbonamenti funzionanti** (decisione utente: implementarli + tenere i crediti): route `subscribe`/`cancel-subscription` (mock-attivi + pronti per Stripe reale via `STRIPE_PRICE_*`), scadenza abbonamento auto-revert a `free`, webhook `checkout.session.completed`/`customer.subscription.deleted`, UI modale con sezione Abbonamenti + annullamento. 42/42 test.
  - ✅ **Onestà dati**: allineato il fallback client ai 7 personaggi seed (stessi ID/nomi → niente più "clic su X → chat con Y") e **rimossi i numeri di utilizzo finti** (usageCount 0).
  - ⏳ **Social login Google/Apple** (decisione utente: implementarli) — richiede credenziali OAuth del cliente (Google Client ID gratuito; Apple Developer account). Prossimo step.
  - ⏳ Restano U3 (cronologia chat), U4 (gestione personaggi), U5 (elimina account UI), U7 (gate login), U9 (recupero password), U10 (profilo personaggio), U11 (storage immagini).

---

## Catalogo bug (riferimento rapido)

### P0 — BLOCKER
- **C1** `server.js` non chiama mai `mongoose.connect()` → ogni query va in `buffering timed out after 10000ms`. App non funzionante. *(prova: register → 500 dopo 10s)*
- **C2** Webhook Stripe: firma HMAC **mai verificata** (`express.json()` globale gira prima della route → `req.body` non è Buffer → `constructEvent` saltato, cade su `event = rawBody`). Chiunque POSTa `/api/payments/webhook` con `metadata.userId/credits` arbitrari ottiene crediti gratis. `payments.js:122-185`, `server.js:20,44`.
- **C3** Modello `gemini-1.5-flash` hardcoded (`geminiService.js:69`, `Message.js:27`) → **ritirato, restituisce 404**. Con key reale ogni messaggio fallisce. Funziona solo in mock.
- **C4** ID personaggi fallback (`6500…01-07`) ≠ ObjectId casuali del seed. Galleria mostra personaggi non chattabili (`POST /chats` → 404). Client e server hanno **due set di fallback diversi con gli stessi id**.

### P1 — ALTI
- **A1** Acquisto crediti finto: `BuyCreditsModal` accredita crediti solo lato client; il server non li aggiunge mai (webhook non parte in mock). Al refresh spariscono. Nessun errore mostrato.
- **A2** Backdoor `x-mock-clerk-id` attivo anche in `NODE_ENV=development` (`auth.js:59`) → bypass auth se deployato in dev.
- **A3** Deduzione crediti non atomica: check su `req.user` (snapshot) + `$inc` senza `runValidators` → saldo negativo sotto concorrenza. `messages.js:21,97`, `images.js:56`.
- **A4** Reset contatori giornalieri mai eseguito (`resetDailyCounts` mai chiamato) → abbonati bloccati per sempre al limite. Il "range limit ogni 24h" non esiste.
- **A5** `updateSession` chiamato senza `await` (`messages.js:110`) → race: il turno precedente può sparire dal contesto LLM; errori inghiottiti.
- **A6** Messaggio di errore AI persistito e rilevato via prefisso stringa (`ChatWindow.tsx:200`) → mostrato rosso per sempre; falsi positivi possibili.
- **A7** Nessuna gestione UX del 402: mostra "Riprova invio" (inutile), non apre il modal crediti, non aggiorna saldo.
- **A8** Nessun age-gate reale su app con NSFW; `birthdate` testo libero non validato → `Mese=13` causa CastError → 500 in registrazione.

### P2 — UX / funzionalità mancanti
- **U1** Ricerca personaggi non funzionante (searchQuery mai usato per fetch/filtro).
- **U2** Tab Feed/Charms/Labs non funzionanti (activeNavTab ignorato da ExploreView).
- **U3** Nessuna cronologia chat in UI (`GET /chats` mai chiamato); ogni click crea una nuova chat → chat orfane.
- **U4** Nessuna gestione dei propri personaggi (`my-characters`/`PUT`/`DELETE` mai usati).
- **U5** Nessun pulsante di cancellazione account (`DELETE /users/me` non esposto).
- **U6** Nessun flusso abbonamento; "Passa a Premium" apre solo il modal crediti (fuorviante vs piano finanziario).
- **U7** Fallback "demo mode" maschera 401/404 ed entra in una chat non funzionante; nessun gate di login.
- **U8** Pulsanti social Google/Apple finti (portano solo al form email).
- **U9** Nessun recupero password → utenti locali bloccati fuori.
- **U10** Nessuna pagina profilo personaggio: il click apre subito una chat (chat-spam).
- **U11** Immagini salvate come data URI base64 nel DB (no Cloudinary; pacchetto non installato).
- **U12** Design system incoerente: pagine legali "Blue & Black" con classi `glass-card`/`glass-panel` **non definite** (pannelli senza stile); resto app in zinc. Il tema "Blue & Black" del piano non è realizzato.

### P3 — Bassi / polish
- **L1** Codice morto: `Navbar.tsx`, `BentoGrid.tsx`, e API server mai chiamate.
- **L2** Animazioni assenti: `animate-fade-in`/`animate-shake` non definite; `font-mono` (JetBrains/Fira) non caricato.
- **L3** Typo validazione: "al massimo 3 caratteri" invece di 30 (`auth.js:39`).
- **L4** Moderazione = 4 regex (inefficace); `isPublic:true`+`moderationStatus:'approved'` di default → pubblicazione senza revisione; nessuna sanitizzazione input.
- **L5** Auth ridondante (cookie httpOnly impostato ma si usa token in localStorage → XSS-exfiltrabile).
- **L6** `GET /characters/:id` ritorna Aria Thorne per qualunque id sconosciuto invece di 404.
- **L7** Idempotency checkout per-giorno blocca riacquisti legittimi; personaggi pubblici orfani dopo delete account.
- **L8** Nessun rate limit su `messages`/`images` (abuso costi API).
- **L9** SPA senza router reale: deep-link/refresh su `/terms`, `/privacy`, `/chat/:id` non funzionano.

---

## Fasi di sviluppo (ordine di esecuzione)

### FASE 0 — Ripristino del funzionamento base *(C1–C4)*
**Obiettivo:** l'app deve funzionare end-to-end con un DB reale e non regalare crediti.
- Creare `server/config/db.js` con `mongoose.connect(MONGODB_URI, {maxPoolSize, serverSelectionTimeoutMS})`; chiamarlo in `server.js` all'avvio (non in test); fail-fast + log su errore. **[C1]**
- Rimontare il webhook: `app.post('/api/payments/webhook', express.raw({type:'application/json'}), handler)` **prima** di `express.json()`; verificare **sempre** la firma; `400` se assente/invalida; rimuovere il ramo che accetta body già parsato. **[C2]**
- Parametrizzare il modello via `GEMINI_MODEL` (default `gemini-2.5-flash`); aggiornare `Message.model`; predisporre per deprecazioni future. **[C3]**
- Unificare i personaggi: seed con **ID deterministici** condivisi da client e server (un unico set) oppure rimuovere i fallback hardcoded e servire sempre dal DB (seed obbligatorio). **[C4]**
- **Exit criteria:** register/login/chat funzionano con DB reale; webhook non firmato → 400; un messaggio reale riceve risposta da Gemini; ogni personaggio della galleria è chattabile.

### FASE 1 — Integrità economica & autenticazione *(A1–A8)*
- Pagamento reale: endpoint server-side che completa la transazione e accredita i crediti (mock: `/payments/confirm`; prod: Stripe Elements + PaymentIntent + webhook). Il client aggiorna il saldo **solo** dalla risposta server. **[A1]**
- Rimuovere il backdoor da `development` (solo `test`, o dietro flag `ENABLE_MOCK_AUTH`). **[A2]**
- Deduzione atomica e condizionale: `findOneAndUpdate({_id, credits:{$gte:cost}}, {$inc:{credits:-cost}}, {new:true})`; null → 402. **[A3]**
- `ensureDailyWindow(user)`: se `lastResetDate < oggi` azzera i contatori prima dei limiti. **[A4]**
- `await updateSession(...)` + summarization affidabile/transazionale. **[A5]**
- Flag esplicito `status:'error'` sui messaggi (niente match per stringa). **[A6]**
- Client: 402 → apri BuyCreditsModal + refetch saldo; 400 moderazione → messaggio dedicato. **[A7]**
- Age-gate: date validate, calcolo età, blocco <13 (<18 per NSFW), validazione birthdate lato server. **[A8]**
- **Exit criteria:** impossibile ottenere crediti senza pagamento server-side; abbonati non si bloccano dopo 24h; nessun saldo negativo sotto carico; UX 402 corretta.

### FASE 2 — Flussi utente attesi *(U1–U11)*
- Sidebar "Le tue chat": `GET /chats`, apri/continua (`GET /chats/:id` + messaggi), elimina (`DELETE /chats/:id`); distinzione "Nuova" vs "Continua". **[U3]**
- "I miei personaggi" con modifica/eliminazione. **[U4]** · Pulsante "Elimina account" con conferma. **[U5]**
- Ricerca con debounce → `?search=`; tab categorie → `?category=`. **[U1,U2]**
- Pagina profilo personaggio prima della chat. **[U10]**
- Non autenticato → apri AuthModal invece del demo-mode. **[U7]**
- Social login reale o nascosto. **[U8]** · Recupero password. **[U9]**
- Abbonamenti reali (create/cancel + webhook) o rimuovere la promessa "Premium". **[U6]**
- Cloudinary/URL storage per le immagini. **[U11]**
- **Exit criteria:** registrarsi → sfogliare/cercare/filtrare → profilo → iniziare/continuare/eliminare chat → gestire personaggi → ricaricare crediti realmente → esportare/eliminare account.

### FASE 3 — Sicurezza & hardening *(L4,L5,L6,L7,L8)*
- Moderazione seria + sanitizzazione input; `moderationStatus:'pending'` + coda revisione per i pubblici. **[L4]**
- Rate limiting su `messages`/`images` (per utente/IP, Redis se disponibile). **[L8]**
- Un solo meccanismo auth (cookie httpOnly), rimuovere token da localStorage, refresh token. **[L5]**
- 404 corretti su `/characters/:id`. **[L6]** · Idempotency per-tentativo. **[L7]**
- **Exit criteria:** niente crediti forgiabili, niente impersonificazione, OWASP di base coperto.

### FASE 4 — Coerenza design & polish *(U12,L1,L2,L3,L9)*
- Uniformare la palette; definire `glass-*`, `animate-fade-in/shake`; caricare `font-mono`. **[U12,L2]**
- Rimuovere/riusare codice morto. **[L1]** · Correggere typo. **[L3]**
- Router reale (react-router) per `/terms`, `/privacy`, `/chat/:id`. **[L9]**
- **Exit criteria:** build pulita, UI coerente, nessun warning console, lint verde.

### FASE 5 — Test & osservabilità
- Test bootstrap via `server.js` con DB effimero (cattura C1); webhook firmato pos/neg (C2); reset giornaliero (A4); concorrenza crediti (A3); id personaggi (C4); frontend (Vitest/RTL) + E2E Playwright del flusso completo.
- Logging strutturato (Winston) + Sentry come da piano.
- **Exit criteria:** suite verde su P0/P1; CI che builda server + client.

---

## Note di conformità (piano_finanziario / progettazione)
- Abbonamento mensile/annuale (cardine del piano ricavi) **non implementato**: solo pacchetti crediti.
- "Range limit rinnovato ogni 24h" **non implementato** (reset giornaliero rotto — A4).
- Tema UI "Blue & Black / Sapphire" del piano **non realizzato** (l'app è grigio/zinc — U12).
- Stima costi API basata su tariffe Gemini 2.5 ma con modello 1.5 ritirato hardcoded (C3): dati economici non attendibili finché non si allinea il modello.

## Riferimenti esterni
- Stripe — verifica firma webhook (usare raw body, route prima di `express.json()`): https://docs.stripe.com/webhooks/signature
- Gemini — deprecazioni (1.5 già spento, usare 2.5-flash): https://ai.google.dev/gemini-api/docs/deprecations
