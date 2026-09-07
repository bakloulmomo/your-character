# Messa in produzione — beta chiusa e gratuita

Configurazione di partenza: **niente pagamenti, niente abbonamenti, niente
immagini generate.** Solo conversazioni, su invito, a costo zero di
infrastruttura. Le ragioni sono in `config/env.js`, accanto agli interruttori.

Costo totale: **0 €/mese**. Le uniche spese variabili sono le chiamate a Gemini
— per quaranta invitati che mandano cinquanta messaggi a testa, meno di 3 $.

---

## 1. Database — MongoDB Atlas (gratuito, per sempre)

1. Crea un cluster **M0** su [cloud.mongodb.com](https://cloud.mongodb.com),
   regione **Frankfurt** o **Ireland** (vicine a Render e agli utenti italiani).
2. *Database Access* → crea un utente con password generata.
3. *Network Access* → consenti `0.0.0.0/0`. Render non ha indirizzi statici sul
   piano gratuito, quindi non c'è alternativa: la protezione reale è la password,
   che va lunga e generata a caso.
4. Copia la stringa di connessione. Sarà `MONGODB_URI`.

> M0 dà 512 MB. Un messaggio pesa circa 500 byte: bastano per oltre un milione
> di messaggi. Non sarà quello il limite che incontrerai per primo.

## 2. Modello conversazionale — Google AI Studio

1. Crea una chiave su [aistudio.google.com](https://aistudio.google.com/apikey).
   Sarà `GEMINI_API_KEY`.
2. Il piano gratuito ha limiti di frequenza ma nessun costo. Se li superi, la
   chiamata fallisce e **il credito viene restituito all'utente** — quel percorso
   è coperto dai test.

## 3. Backend — Render (gratuito)

Il repository contiene già `render.yaml`: da *New → Blueprint*, puntando al
repository, Render legge tutto da lì e chiede solo i valori marcati `sync: false`.

Variabili da inserire a mano:

| Variabile | Valore |
|---|---|
| `MONGODB_URI` | dal passo 1 |
| `GEMINI_API_KEY` | dal passo 2 |
| `FRONTEND_URL` | l'URL Vercel del passo 4 — **torna a compilarlo dopo** |
| `BETA_INVITE_CODE` | il codice che darai agli invitati, es. `AMICI-2026` |
| `ADMIN_EMAILS` | la tua email: ci arrivano le notifiche. **Non ti rende amministratore** |

`JWT_SECRET` lo genera Render da sé (`generateValue: true`). Non copiarlo da
nessuna parte e non riusarlo altrove.

> **Il piano gratuito sospende il servizio dopo 15 minuti di inattività**, e la
> prima richiesta dopo una pausa attende circa 50 secondi. Su una beta a inviti
> è tollerabile. Non lo sarebbe su un lancio pubblico: quando arriverà, cambia
> `plan: free` in `plan: starter` (7 $/mese) — nessuna modifica al codice.

## 4. Frontend — Vercel (gratuito)

1. Importa il repository, **Root Directory: `client`**. Il resto lo rileva da sé.
2. **Prima del primo deploy**, apri `client/vercel.json` e sostituisci l'host
   nella riscrittura con quello del backend Render:

   ```json
   { "source": "/api/:path*",
     "destination": "https://IL-TUO-BACKEND.onrender.com/api/:path*" }
   ```

   Non è un dettaglio di comodità. È ciò che rende l'API **same-origin** per il
   browser, e da questo dipendono due cose: il cookie di sessione `httpOnly`
   (che con `SameSite=Lax` non viaggerebbe verso un'altra origine) e la
   direttiva `connect-src 'self'` della CSP. Senza, nessuno riesce ad accedere.

3. Nessuna variabile d'ambiente serve per la beta:
   `VITE_STRIPE_PUBLISHABLE_KEY` riguarda i pagamenti, che sono spenti.

4. Torna su Render e compila `FRONTEND_URL` con l'URL Vercel.

## 5. Verifica che sia davvero in piedi

```bash
# Il servizio risponde
curl https://IL-TUO-BACKEND.onrender.com/health

# Gli interruttori sono nella posizione giusta
curl https://IL-TUO-DOMINIO.vercel.app/api/config
# atteso: {"features":{"payments":false,"subscriptions":false,
#          "imageGeneration":false},"paymentsMode":"mock","inviteRequired":true}

# Le funzioni spente sono chiuse SUL SERVER, non solo nascoste
curl -X POST https://IL-TUO-DOMINIO.vercel.app/api/images/generate   # atteso: 404

# Senza invito non si entra
curl -X POST https://IL-TUO-DOMINIO.vercel.app/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"x@y.it","username":"prova","password":"Password1","birthdate":"1990-01-01"}'
# atteso: 403 con requiresInvite
```

Poi, dal browser: registrati col tuo indirizzo, apri una conversazione, e
verifica che **ricaricando la pagina resti connesso** — è la prova che il cookie
attraversa la riscrittura.

### Diventare amministratore

Nessuna variabile d'ambiente concede il ruolo: un'email non è verificata, quindi
non è un'identità. Dopo esserti registrato dall'interfaccia, da un terminale con
l'URI di Atlas a portata:

```bash
cd server
MONGODB_URI="<la stessa stringa messa su Render>" \
  node scripts/grantRole.js tua@email.it admin
```

Esci e rientra: la voce «Moderazione» compare nella barra laterale.

## 6. Popolare la galleria

Una galleria vuota è la prima cosa che vede un invitato.

```bash
cd server && MONGODB_URI="<la tua stringa>" npm run seed
```

Oppure creane a mano dal tuo account: i personaggi pubblici passano dalla coda di
revisione, che approvi tu da `/moderation`.

---

## Prima di aprire agli inviti

- [ ] Hai aperto `/moderation` almeno una volta e sai com'è fatta
- [ ] Hai deciso **quanto spesso** guardi la coda (una volta al giorno è il minimo
      con contenuti 18+) e cosa fai se arriva qualcosa di illegale
- [ ] Hai provato tu il percorso completo su un telefono, non solo sul portatile
- [ ] Sai a chi scrivono gli invitati quando qualcosa non funziona
- [ ] `RESEND_API_KEY` configurata, **oppure** hai accettato che il recupero
      password non funzioni e lo dici agli invitati

## Cosa NON è ancora attivo, e perché

| Funzione | Stato | Cosa serve per accenderla |
|---|---|---|
| Pagamenti | spenti | Partita IVA, regime OSS, `SELLER_*`, chiavi Stripe, `STRIPE_WEBHOOK_SECRET` |
| Abbonamenti | spenti | I pagamenti, più tetti giornalieri che stiano sotto il costo |
| Immagini | spente | Un ricavo che le sostenga: costano 0,025 $ l'una contro 0,0015 $ di un messaggio |
| Cloudinary | non serve | Serve solo con le immagini accese |

Accendere i pagamenti senza i dati fiscali **non è possibile**: la guardia
d'avvio rifiuta di far partire il server e dice quale variabile manca. È
voluto — vendere senza intestazione fiscale non è una configurazione valida.

## Se qualcosa va storto

Ogni risposta porta un `x-request-id`. Cercalo nei log di Render e trovi tutte le
righe di quella richiesta, con i segreti già redatti.

| Sintomo | Causa quasi certa |
|---|---|
| Il server non parte | Leggi il messaggio: elenca **tutte** le variabili mancanti insieme |
| Login riuscito ma disconnesso al ricaricamento | La riscrittura in `vercel.json` punta ancora all'host di esempio |
| Le chiamate API danno 404 | Stessa causa |
| Risposte «simulate — nessun credito addebitato» | `GEMINI_API_KEY` mancante o segnaposto |
| Prima richiesta lentissima dopo una pausa | Piano gratuito Render, è previsto |
