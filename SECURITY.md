# Sicurezza — rilevare, contenere, ruotare, comunicare

Questo non è un elenco di buone intenzioni: è cosa fare, in che ordine, quando
qualcosa sta andando storto. Chi lo legge di solito lo legge di fretta, quindi
i comandi sono scritti per essere copiati.

Le difese che il codice ha già — e il debito che ha ancora — stanno in fondo.

---

## 1. Rilevare

### Dove guardare

| Cosa | Dove |
|---|---|
| Log applicativi, in tempo reale | Render → servizio `your-character-api` → *Logs* |
| Errori con stack e contesto | Sentry (se `SENTRY_DSN` è configurato) |
| Spesa e volumi | `GET /api/admin/metrics`, con un account `admin` |
| Stato del servizio | `GET /health` — non richiede autenticazione |

Ogni riga di log porta un `requestId`, restituito anche al client nel corpo
degli errori. **È il modo per collegare la segnalazione di una persona alla riga
esatta**: se qualcuno scrive «non funziona» e allega un codice, si cerca quello.

### Soglie che meritano un'occhiata

Nessuna di queste è un allarme automatico — non esiste ancora un sistema di
allerta, ed è un debito dichiarato più sotto. Sono i numeri da guardare quando
si sospetta qualcosa.

- **429 in aumento su `/api/auth/login`** → qualcuno sta provando password.
  Atteso: pochi al giorno. Un picco significa un attacco in corso, già contenuto
  dal limitatore (5 tentativi ogni 15 minuti, con `skipSuccessfulRequests`).
- **Registrazioni molto sopra la media** → se `BETA_INVITE_CODE` è impostato,
  significa che il codice è circolato. Cambiarlo (§2).
- **Spesa Gemini fuori scala rispetto agli utenti attivi** → o un abuso, o un
  difetto che manda al modello più richieste di quelle che l'utente ha chiesto.
  Il tetto giornaliero per utente è `BETA_DAILY_MESSAGE_CAP`.
- **5xx concentrati su una rotta** → quasi sempre un difetto, non un attacco. Ma
  un 5xx che si può provocare a comando È un attacco: consuma CPU e riempie
  Sentry a costo zero per chi lo lancia.
- **Tempi di risposta che crescono su TUTTE le rotte insieme** → event loop
  bloccato. Su un'istanza singola una sola richiesta costosa ferma tutto,
  incluso il webhook di Stripe.

---

## 2. Contenere

**In quest'ordine.** I primi tre passi non richiedono un rilascio: si fanno dal
pannello di Render cambiando una variabile d'ambiente, e il servizio riparte in
meno di un minuto.

### a. Spegnere la funzionalità coinvolta

```
FEATURE_PAYMENTS=false
FEATURE_SUBSCRIPTIONS=false
FEATURE_IMAGE_GENERATION=false
```

Non è cosmesi: `requireFeature` sta **sulla rotta**, quindi a interruttore
spento l'endpoint risponde 404 e non esiste più. L'interfaccia si adegua da
sola, perché legge `GET /api/config` all'avvio e non mostra comandi che
porterebbero a un errore.

### b. Chiudere la porta d'ingresso

```
BETA_INVITE_CODE=<un valore nuovo>
```

Con un codice impostato, `POST /api/auth/register` lo richiede. Cambiarlo
invalida tutti gli inviti già distribuiti: è la leva giusta se il codice è
finito dove non doveva.

### c. Alzare o abbassare i limiti

```
GLOBAL_RATE_MAX=60        # normale: 240 al minuto per chiave
LOGIN_RATE_MAX=3          # normale: 5 ogni 15 minuti
BETA_DAILY_MESSAGE_CAP=5  # normale: 25
```

### d. Revocare le sessioni

Ogni token porta il campo `tv`, confrontato a **ogni richiesta** con
`user.tokenVersion`. Incrementare il contatore invalida immediatamente tutti i
token di quell'account, ovunque si trovino.

```bash
cd server
# Un solo account
MONGODB_URI="<uri di produzione>" node -e "
  require('dotenv').config();
  const m = require('mongoose'), U = require('./models/User');
  m.connect(process.env.MONGODB_URI)
    .then(() => U.updateOne({ email: 'tizio@example.com' }, { \$inc: { tokenVersion: 1 } }))
    .then(r => { console.log('sessioni revocate:', r.modifiedCount); return m.disconnect(); });
"

# TUTTI gli account — misura drastica: obbliga chiunque a rientrare.
MONGODB_URI="<uri di produzione>" node -e "
  require('dotenv').config();
  const m = require('mongoose'), U = require('./models/User');
  m.connect(process.env.MONGODB_URI)
    .then(() => U.updateMany({}, { \$inc: { tokenVersion: 1 } }))
    .then(r => { console.log('account:', r.modifiedCount); return m.disconnect(); });
"
```

### e. Sospendere un account

Dal pannello di moderazione (`/moderation`, ruolo `moderator` o `admin`), oppure
`POST /api/admin/users/:id/ban`. La sospensione revoca anche le sessioni. Se ha
una scadenza, viene tolta da sola al primo accesso successivo.

### f. Fermare tutto

Su Render: *Suspend Web Service*. Il client resta in piedi e mostra i propri
stati di errore; nessun dato si perde. Da usare quando non si è ancora capito
cosa stia succedendo — un'ora di servizio fermo costa meno di un'ora di
esfiltrazione.

---

## 3. Ruotare i segreti

**In quest'ordine**, perché il primo chiude le sessioni e gli altri no.

| Segreto | Dove si cambia | Effetto immediato |
|---|---|---|
| `JWT_SECRET` | Render → *Environment* | **Tutte** le sessioni cadono. È previsto: nessun dato si perde, ognuno rientra. Su Render è `generateValue: true`, quindi si rigenera dal pannello. |
| `MONGODB_URI` | Atlas → *Database Access*, nuova password → Render | Il servizio si riavvia. Se l'URI vecchio è compromesso, va cambiata la password dell'utente del database, non solo la stringa. |
| `GEMINI_API_KEY` | Google AI Studio: crea la nuova, aggiorna Render, **poi** revoca la vecchia | In quest'ordine non c'è interruzione. Al contrario, sì. |
| `STRIPE_SECRET_KEY` | Dashboard Stripe → *API keys* → *Roll* | I pagamenti in corso falliscono per qualche secondo. |
| `STRIPE_WEBHOOK_SECRET` | Dashboard Stripe → l'endpoint → *Reveal / roll* | Finché non è aggiornato su Render, **i webhook vengono rifiutati**: la firma non torna. Stripe ritenta per tre giorni, quindi gli accrediti arrivano lo stesso — ma in ritardo. |
| `BETA_INVITE_CODE`, `ADMIN_EMAILS`, `RESEND_API_KEY` | Render | Nessun effetto sulle sessioni. |

**Chi se ne accorge:** ruotare `JWT_SECRET` butta fuori tutti in una volta. Se
il servizio è pubblico, va detto — vedi §4 — altrimenti la reazione è una raffica
di segnalazioni «mi ha disconnesso».

### Ruolo di amministratore

Nessuna variabile d'ambiente concede privilegi. Un'email non è verificata,
quindi non è un'identità: `ADMIN_EMAILS` serve solo come recapito per le
notifiche. Il ruolo si concede fuori banda, con accesso al database:

```bash
cd server
MONGODB_URI="<uri di produzione>" node scripts/grantRole.js tizio@example.com admin
# per revocare:
MONGODB_URI="<uri di produzione>" node scripts/grantRole.js tizio@example.com user
```

---

## 4. Comunicare

Tre passaggi, deliberatamente pochi.

1. **Entro un'ora** — se il servizio è degradato o fermo, dirlo dove gli utenti
   guardano, con: cosa non funziona, se i dati sono coinvolti, quando arriverà
   il prossimo aggiornamento. Un «stiamo verificando» tempestivo vale più di una
   ricostruzione completa il giorno dopo.

2. **Entro 72 ore** — se sono stati coinvolti **dati personali**, l'art. 33 GDPR
   impone la notifica al Garante. Il termine decorre da quando ne si è venuti a
   conoscenza, non da quando si è finito di indagare: in caso di dubbio si
   notifica e si integra dopo. Se il rischio per le persone è elevato (art. 34),
   vanno informate anche loro, direttamente.

   Dati personali trattati da questo servizio: email, nome utente, data di
   nascita, **testo delle conversazioni**, paese di fatturazione, storico delle
   transazioni. Le conversazioni sono la categoria più delicata: sono contenuti
   intimi, e l'informativa lo dichiara in cima.

3. **A chiusura** — cosa è successo, cosa è stato cambiato, cosa impedisce che
   riaccada. Se la risposta all'ultimo punto è «staremo più attenti», non è
   ancora chiusa: serve un test, un controllo automatico o un vincolo che renda
   la ripetizione impossibile.

---

## Come segnalare una vulnerabilità

Scrivere a **security@your-character.app** con la descrizione, i passi per
riprodurla e l'impatto atteso. Nessuna segnalazione fatta in buona fede porterà
a conseguenze legali. Non pubblicare i dettagli finché non è stata corretta, e
non usare l'accesso ottenuto per leggere dati di altre persone: una prova di
concetto sul proprio account basta a dimostrarla.

---

## Cosa protegge già

Verificato dai test, non dichiarato: 320 test lato server, 90 lato client,
7 end-to-end, tutti in CI.

- **Sessioni** — JWT firmato HS256 in cookie `httpOnly` + `Secure` + `SameSite=Lax`,
  token in memoria e mai in `localStorage`, revoca reale via `tokenVersion`.
- **Ingresso** — nessun privilegio deriva da un dato fornito dall'utente; il
  ruolo si concede solo fuori banda; la beta è chiusa da un codice d'invito;
  l'indirizzo email è confermato con un codice prima di poter scrivere, creare
  o pagare.
- **Querystring** — parser `simple`: `?campo[$ne]=x` arriva come stringa, quindi
  un operatore Mongo non può entrare in un filtro da nessuna rotta, non solo da
  quelle che se ne ricordano.
- **Corpi** — solo JSON: `express.urlencoded` non è montato, e la sua assenza è
  ciò che chiude il vettore CSRF classico (un `<form>` cross-origin non può
  produrre un corpo JSON).
- **Tenuta** — `/health` controlla davvero la connessione al database e risponde
  503 quando manca; `SIGTERM` lascia finire le richieste in volo prima di
  chiudere; le scadenze promesse nell'informativa sono applicate da un job
  (`services/retention.js`), non solo dichiarate.
- **Limiti** — undici limitatori distinti, per utente quando c'è un utente e per
  subnet IP altrimenti, con `trust proxy` a un solo salto.
- **Denaro** — firma del webhook obbligatoria in ogni ambiente, senza rami
  alternativi; rivendicazione atomica della transazione; accredito basato sul
  record del server e non sui metadati dell'evento; indice unico sul
  PaymentIntent, così l'idempotenza vive nel database.
- **Crediti** — riserva atomica prima della chiamata al modello, con rimborso se
  la risposta viene bloccata; piano sconosciuto ⇒ nessuna allowance.
- **Modello** — regole di piattaforma prima del contenuto utente, contenuto
  utente sempre delimitato e dichiarato «non istruzioni», moderazione su quattro
  superfici (messaggio, risposta in streaming, riassunto, profilo del
  personaggio), impostazioni di sicurezza native di Gemini, percorso separato
  per l'autolesionismo.
- **Contenuti pubblicati** — un personaggio pubblico è online appena creato, ma
  il suo profilo passa **prima** dal filtro automatico: un profilo vietato non
  viene mai scritto. La revisione umana è successiva — la coda elenca ciò che è
  pubblicato e nessuno ha ancora guardato — e la rimozione è definitiva: un
  personaggio rimosso non torna online se l'autore lo modifica.
- **Input** — schemi Zod che scartano le chiavi sconosciute (quindi niente
  mass-assignment), identificativi validati prima di Mongoose, parametri della
  querystring convertiti a stringa prima di entrare in un filtro.
- **Pagina** — CSP senza `unsafe-inline` sugli script, HSTS, `X-Frame-Options`,
  `Permissions-Policy`, API same-origin per riscrittura. Nessun
  `dangerouslySetInnerHTML` in tutto il client.
- **Log** — redazione dichiarativa dei segreti nella configurazione del logger,
  `x-request-id` in ingresso validato, corpi delle email mai registrati, Sentry
  con `sendDefaultPii: false` e i corpi delle richieste rimossi.
- **In CI** — lint, tipi, build, 3 controlli del sistema di design, `npm audit`
  a soglia `moderate`, CodeQL, Dependabot, e un controllo che nessun `.env`
  finisca nel repository.

---

## Debito noto, e la soglia che lo rende inaccettabile

Elencato perché un cliente o un investitore lo chiede, e perché scriverlo è
l'unico modo per non dimenticarlo.

| Manca | Rischio oggi | Quando diventa non più accettabile |
|---|---|---|
| ~~**Verifica dell'email**~~ | **Fatto.** Codice a sei cifre, impronta SHA-256, cinque tentativi, quindici minuti. Senza conferma non si scrive, non si creano personaggi, non si compra. Gli account mai confermati si cancellano da soli dopo sette giorni | — |
| **Token CSRF** | Basso: `SameSite=Lax` + API same-origin + corpi JSON coprono i casi pratici | Se una rotta di modifica diventasse raggiungibile con `GET` o con un form |
| **2FA** | Un account compromesso è compromesso | Quando esisteranno account con contenuti che le persone non possono ricreare |
| ~~**Sessione di 7 giorni senza rotazione**~~ | **Ridotto.** Due giorni invece di sette, con ri-emissione silenziosa sotto le dodici ore residue: chi torna spesso non se ne accorge, chi si è fatto rubare il token ha una finestra tre volte più stretta. Durata, firma, cookie e rinnovo stanno in un posto solo (`server/services/session.js`) | Resta la revoca immediata: oggi un token rubato vale fino a due giorni, a meno di incrementare `tokenVersion` a mano |
| **Backup del database** | Copia notturna cifrata via GitHub Actions (`.github/workflows/backup.yml`), retention 30 giorni. Resta un ripiego: granularità 24 ore, e la chiave vive nei segreti del repository | Passare agli snapshot gestiti di Atlas quando i dati valgono più di 10 €/mese. **E il ripristino di prova va eseguito davvero**: finché la tabella in `DEPLOY.md` è vuota, questo backup non è dimostrato |
| **Limitatori in memoria** | Corretto su un'istanza sola; scalando in orizzontale il limite effettivo si moltiplica per il numero di istanze | Al primo passaggio a più di un'istanza |
| **`0.0.0.0/0` su Atlas** | La rete non filtra: proteggono solo le credenziali | Quando l'hosting offrirà IP in uscita stabili |
| **Nessun avviso automatico** | Un abuso si scopre guardando. Le email non recapitate ora almeno si contano (`mail.failed` in `/api/admin/metrics`) invece di sparire | Appena il servizio ha utenti che se ne accorgerebbero prima di noi |
| **Nessun monitoraggio di disponibilità** | Un servizio fermo si scopre da una segnalazione | Come sopra |
| **Rotazione periodica delle chiavi** | Le chiavi restano valide finché qualcuno non le cambia a mano | Con più di una persona ad avere accesso alla produzione |
| **Percorso di pagamento con carta mai eseguito da capo a fondo** | Il codice c'è e i test lo coprono, ma nessuna carta vera ci è mai passata | Prima di accendere `FEATURE_PAYMENTS` |
