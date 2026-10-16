import { expect, type Page } from '@playwright/test';

/**
 * Aiuti condivisi dei percorsi end-to-end.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `register` era scritto TRE volte, quasi identico, in `journey`, `confirm` e
 * `moderation`. Quando la registrazione ha acquisito un passaggio in più — la
 * conferma dell'indirizzo — le tre copie si sono rotte insieme, e sistemarle
 * avrebbe voluto dire scrivere tre volte la stessa correzione. Qui è una.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const sidebar = (page: Page) =>
  page.getByRole('complementary', { name: 'Navigazione principale' });

/** Estrae le sei cifre dall'oggetto o dal corpo del messaggio. */
const cifre = (m: { subject?: string; text?: string } | undefined) =>
  `${m?.subject ?? ''} ${m?.text ?? ''}`.match(/\b(\d{6})\b/)?.[1] ?? null;

/**
 * Il codice di conferma, letto dalla casella di posta di sviluppo.
 *
 * Non si può leggere dal database: il server ne conserva solo l'impronta
 * SHA-256, che è la scelta giusta e rende il codice irrecuperabile per
 * chiunque, test compresi. `GET /api/dev/outbox` esiste solo con `DEV_OUTBOX=1`
 * fuori produzione — `scripts/e2eStack.js` la imposta — e restituisce le email
 * che non sono partite perché nessun trasporto è configurato.
 */
async function leggiCodice(page: Page, email: string): Promise<string> {
  const chiedi = async () => {
    const r = await page.request.get(`/api/dev/outbox?to=${encodeURIComponent(email)}`);
    if (!r.ok()) return null;
    const { messages } = await r.json();
    return cifre(messages?.[0]);
  };

  await expect
    .poll(chiedi, { timeout: 10000, message: `nessun codice di conferma per ${email}` })
    .not.toBeNull();

  return (await chiedi())!;
}

/**
 * Registra un account e ne CONFERMA l'indirizzo.
 *
 * La conferma non è un dettaglio da saltare: `requireVerifiedEmail` protegge
 * messaggi, conversazioni, personaggi e pagamenti, quindi un account non
 * confermato può guardare il catalogo e nient'altro. Un aiuto che si fermasse
 * alla registrazione verificherebbe un prodotto che nessuno può usare.
 *
 * Attraversa lo stesso modulo di un utente vero — la vista «verify» del modale
 * e il campo a sei cifre — invece di chiamare l'API di conferma da sotto: se
 * quel modulo si rompe, i percorsi devono accorgersene.
 */
export async function registraEConferma(
  page: Page,
  email: string,
  username: string,
  opzioni: { apriDa?: 'sidebar' | 'pagina' } = {}
) {
  const bottone =
    opzioni.apriDa === 'sidebar'
      ? sidebar(page).getByRole('button', { name: 'Registrati' })
      : page.getByRole('button', { name: 'Registrati' }).first();

  await bottone.click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Nome utente').fill(username);
  await page.getByLabel('Password', { exact: true }).fill('Password1');
  await page.getByLabel('Giorno').selectOption('14');
  await page.getByLabel('Mese').selectOption('2');
  await page.getByLabel('Anno').selectOption('1995');
  await page.getByRole('button', { name: 'Crea account' }).click();

  // Il modale passa da sé alla conferma: è il momento in cui l'utente è più
  // disposto a inserire il codice, e il prodotto non lo lascia andare via.
  await expect(page.getByRole('heading', { name: 'Conferma il tuo indirizzo' })).toBeVisible();

  const codice = await leggiCodice(page, email);

  /**
   * Si scrive il codice, e NON si preme «Conferma».
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `CodeInput` chiama `onComplete` appena le sei cifre ci sono, e in
   * `AuthModal` quella richiamata È `confirmCode`: l'ultima cifra invia da sé.
   * È la scelta giusta — chi ha appena ricopiato un codice dal telefono non
   * deve anche cercare un pulsante — ma rende il pulsante una corsa contro la
   * richiesta che l'ultima cifra ha già fatto partire.
   *
   * Premendolo comunque, il test aspettava un elemento che nel frattempo era
   * `disabled` (richiesta in volo) e poi staccato dal DOM (modale chiuso), e
   * restava lì fino al timeout di sessanta secondi — con l'account già
   * confermato alle sue spalle. Cinque percorsi su nove morivano così.
   *
   * Il pulsante resta nell'interfaccia e non è ridondante: serve a chi arriva
   * con le cifre già incollate e a chi naviga da tastiera. Semplicemente non è
   * il modo in cui si attraversa questo passaggio, quindi il test aspetta
   * l'ESITO — il modale che si chiude — invece del comando.
   * ───────────────────────────────────────────────────────────────────────────
   */
  await page
    .getByRole('group', { name: /Codice di conferma/ })
    .getByRole('textbox')
    .first()
    .fill(codice);

  // Il modale sparisce solo a conferma riuscita: è l'asserzione che distingue
  // «il codice è stato accettato» da «il codice è stato scritto».
  await expect(page.getByRole('heading', { name: 'Conferma il tuo indirizzo' })).toBeHidden();
  await expect(sidebar(page).getByText(`@${username}`)).toBeVisible();
}
