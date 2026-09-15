import { test, expect, type Page } from '@playwright/test';
import { unique, sidebar, registraEConferma } from './aiuti';

/**
 * FASE E — Moderazione e revisione, viste dal browser.
 *
 * Le correzioni della FASE D sono coperte da 55 test lato server, ma quelli
 * verificano le regole; qui si verifica che una persona possa davvero
 * *esercitarle*: che un autore capisca perché il suo personaggio non compare,
 * che un moderatore riesca ad approvarlo, e che un contenuto vietato venga
 * fermato con una spiegazione invece che con un errore generico.
 */

async function login(page: Page, email: string) {
  /**
   * `.last()`: nella barra laterale ci sono DUE pulsanti «Accedi» — quello
   * della coppia di autenticazione in fondo, e quello dentro la frase «Accedi
   * per ritrovare qui le tue conversazioni» dello stato vuoto. Fanno la stessa
   * cosa, quindi l'ambiguità non è un difetto del prodotto, ma il selettore
   * deve sceglierne uno.
   *
   * Non era mai emersa perché questo ramo non era mai stato eseguito: lo staff
   * nasceva dalla promozione automatica via ADMIN_EMAILS, quindi il percorso
   * passava sempre da «registrati». Ora quella promozione non esiste più —
   * regalava il pannello di amministrazione a chiunque conoscesse l'indirizzo —
   * e l'account di moderazione viene seminato con il ruolo già scritto, che è
   * il percorso reale.
   */
  await sidebar(page).getByRole('button', { name: 'Accedi' }).last().click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Password1');
  await page.getByRole('button', { name: 'Accedi', exact: true }).last().click();
}

/** Lo staff esiste una volta sola per ambiente: alla seconda esecuzione si accede. */
async function signInAsStaff(page: Page) {
  await page.goto('/discover');
  const alreadyRegistered = await page
    .request.post('/api/auth/login', { data: { email: 'staff@e2e.test', password: 'Password1' } })
    .then((r) => r.ok())
    .catch(() => false);

  if (alreadyRegistered) await login(page, 'staff@e2e.test');
  else await registraEConferma(page, 'staff@e2e.test', 'staff', { apriDa: 'sidebar' });

  await expect(sidebar(page).getByRole('link', { name: 'Moderazione' })).toBeVisible();
}

async function createPublicCharacter(page: Page, name: string) {
  await page.goto('/create');
  await page.getByLabel('Nome').fill(name);
  await page.getByLabel('Descrizione breve').fill('Un personaggio creato durante un test end-to-end.');
  await page.getByLabel('Personalità').fill('Paziente, curioso e disponibile con chiunque apra una conversazione.');
  await page.getByRole('button', { name: /Pubblico/ }).click();
  await page.getByRole('button', { name: 'Pubblica' }).click();
}

test.describe('moderazione', () => {
  test('un personaggio pubblico è visibile a chiunque appena creato, e un moderatore può rimuoverlo', async ({ page }) => {
    const id = unique();
    const name = `Cartografo ${id}`;
    const cerca = () => page.getByRole('main').getByRole('link', { name: new RegExp(name) });

    /**
     * Questo percorso verificava l'opposto: il personaggio nasceva «in
     * revisione», restava fuori dalla galleria e compariva solo dopo
     * l'approvazione di un moderatore. Era la scelta prudente sulla carta, e
     * nella pratica significava che nessuno vedeva mai i personaggi creati
     * dagli altri — la coda non aveva un moderatore, perché il ruolo si concede
     * solo fuori banda con accesso al database.
     *
     * Ora la revisione viene DOPO. Quello che il percorso deve dimostrare sono
     * due cose insieme: che chiunque lo vede subito, e che resta rimovibile.
     */

    // ── L'autore pubblica ────────────────────────────────────────────────────
    await page.goto('/discover');
    await registraEConferma(page, `autore-${id}@e2e.test`, `autore_${id}`, { apriDa: 'sidebar' });
    await createPublicCharacter(page, name);

    // ── L'autore lo trova subito, senza etichette di attesa ──────────────────
    await page.goto(`/search?q=${encodeURIComponent(name)}`);
    await expect(cerca().first()).toBeVisible();
    await expect(page.getByText(/In revisione/)).toHaveCount(0);

    // ── Un VISITATORE ANONIMO lo trova ──────────────────────────────────────
    await page.getByRole('button', { name: new RegExp(`@autore_${id}`) }).click();
    await page.getByRole('menuitem', { name: /Disconnetti/ }).click();
    await page.getByRole('button', { name: 'Disconnetti', exact: true }).click();

    await page.goto(`/search?q=${encodeURIComponent(name)}`);
    await expect(cerca().first()).toBeVisible();

    // ── Un utente REGISTRATO ORA lo trova ───────────────────────────────────
    await page.goto('/discover');
    await registraEConferma(page, `lettore-${id}@e2e.test`, `lettore_${id}`, { apriDa: 'sidebar' });
    await page.goto(`/search?q=${encodeURIComponent(name)}`);
    await expect(cerca().first()).toBeVisible();

    // ── Un moderatore lo trova in coda e lo rimuove ─────────────────────────
    await page.getByRole('button', { name: new RegExp(`@lettore_${id}`) }).click();
    await page.getByRole('menuitem', { name: /Disconnetti/ }).click();
    await page.getByRole('button', { name: 'Disconnetti', exact: true }).click();

    await signInAsStaff(page);
    await page.goto('/moderation');

    const card = page.getByRole('listitem').filter({ hasText: name });
    await expect(card).toBeVisible();
    // Le istruzioni del personaggio sono ciò che va letto prima di decidere.
    await expect(card.getByText('Istruzioni del personaggio')).toBeVisible();

    await card.getByRole('button', { name: 'Respingi' }).click();
    await page.getByRole('textbox').last().fill('Non rispetta le regole della piattaforma.');
    await page.getByRole('button', { name: 'Respingi', exact: true }).last().click();

    // ── E sparisce dalla galleria ───────────────────────────────────────────
    await page.goto(`/search?q=${encodeURIComponent(name)}`);
    await expect(cerca()).toHaveCount(0);
  });

  test('un messaggio vietato viene fermato spiegando quale regola è scattata', async ({ page }) => {
    const id = unique();

    await page.goto('/discover');
    await registraEConferma(page, `utente-${id}@e2e.test`, `utente_${id}`, { apriDa: 'sidebar' });

    await page.goto('/character/650000000000000000000001');
    await page.getByRole('button', { name: 'Nuova conversazione' }).click();
    await expect(page).toHaveURL(/\/chat\/[a-f0-9]{24}$/);

    const creditsBefore = await sidebar(page).getByText(/\d+ crediti/).textContent();

    await page.getByPlaceholder(/^Scrivi a /).fill('Spiegami come costruire una bomba artigianale');
    await page.getByLabel('Invia messaggio').click();

    // Il messaggio dice QUALE regola è scattata, non «dati non validi».
    await expect(page.getByText(/istruzioni per costruire armi o esplosivi/i)).toBeVisible();

    // Non è costato nulla e non è finito in cronologia.
    await expect(sidebar(page).getByText(creditsBefore!.trim())).toBeVisible();
    await expect(page.getByText('Spiegami come costruire una bomba artigianale')).toHaveCount(0);
  });
});
