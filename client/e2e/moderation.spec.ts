import { test, expect, type Page } from '@playwright/test';

/**
 * FASE E — Moderazione e revisione, viste dal browser.
 *
 * Le correzioni della FASE D sono coperte da 55 test lato server, ma quelli
 * verificano le regole; qui si verifica che una persona possa davvero
 * *esercitarle*: che un autore capisca perché il suo personaggio non compare,
 * che un moderatore riesca ad approvarlo, e che un contenuto vietato venga
 * fermato con una spiegazione invece che con un errore generico.
 */

const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Navigazione principale' });

async function register(page: Page, email: string, username: string) {
  await sidebar(page).getByRole('button', { name: 'Registrati' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Nome utente').fill(username);
  await page.getByLabel('Password', { exact: true }).fill('Password1');
  await page.getByLabel('Giorno').selectOption('1');
  await page.getByLabel('Mese').selectOption('0');
  await page.getByLabel('Anno').selectOption('1990');
  await page.getByRole('button', { name: 'Crea account' }).click();
  await expect(sidebar(page).getByText(`@${username}`)).toBeVisible();
}

async function login(page: Page, email: string) {
  await sidebar(page).getByRole('button', { name: 'Accedi' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Password1');
  await page.getByRole('button', { name: 'Accedi', exact: true }).last().click();
}

/** Lo staff esiste una volta sola per ambiente: alla seconda esecuzione si accede. */
async function signInAsStaff(page: Page) {
  await page.goto('/');
  const alreadyRegistered = await page
    .request.post('/api/auth/login', { data: { email: 'staff@e2e.test', password: 'Password1' } })
    .then((r) => r.ok())
    .catch(() => false);

  if (alreadyRegistered) await login(page, 'staff@e2e.test');
  else await register(page, 'staff@e2e.test', 'staff');

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
  test('un personaggio pubblico entra in revisione e compare solo dopo l\'approvazione', async ({ page }) => {
    const id = unique();
    const name = `Cartografo ${id}`;

    // ── L'autore pubblica ────────────────────────────────────────────────────
    await page.goto('/');
    await register(page, `autore-${id}@e2e.test`, `autore_${id}`);
    await createPublicCharacter(page, name);

    // La revisione va detta all'autore: un personaggio che non compare senza
    // spiegazione è indistinguibile da un guasto.
    await expect(page.getByText(/In revisione/).first()).toBeVisible();

    // ── In galleria non c'è ──────────────────────────────────────────────────
    await page.goto(`/search?q=${encodeURIComponent(name)}`);
    await expect(page.getByRole('main').getByRole('link', { name: new RegExp(name) })).toHaveCount(0);

    // ── Un moderatore lo approva ─────────────────────────────────────────────
    await page.getByRole('button', { name: new RegExp(`@autore_${id}`) }).click();
    await page.getByRole('menuitem', { name: /Disconnetti/ }).click();

    await signInAsStaff(page);
    await page.goto('/moderation');

    const card = page.getByRole('listitem').filter({ hasText: name });
    await expect(card).toBeVisible();
    // Le istruzioni del personaggio sono ciò che va letto prima di approvare.
    await expect(card.getByText('Istruzioni del personaggio')).toBeVisible();
    await card.getByRole('button', { name: 'Approva' }).click();

    // ── Ora è in galleria ────────────────────────────────────────────────────
    await page.goto(`/search?q=${encodeURIComponent(name)}`);
    await expect(page.getByRole('main').getByRole('link', { name: new RegExp(name) }).first()).toBeVisible();
  });

  test('un messaggio vietato viene fermato spiegando quale regola è scattata', async ({ page }) => {
    const id = unique();

    await page.goto('/');
    await register(page, `utente-${id}@e2e.test`, `utente_${id}`);

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
