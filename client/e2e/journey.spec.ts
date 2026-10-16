import { test, expect, type Page } from '@playwright/test';
import { unique, sidebar, registraEConferma } from './aiuti';

/**
 * FASE E — Il percorso completo, in un browser vero (punto 3 del piano).
 *
 * Registrazione → esplora → cerca → scheda personaggio → chat → esaurimento
 * crediti → acquisto → la conversazione riprende → eliminazione dell'account.
 *
 * È l'unico test che può dire «il prodotto funziona». I 202 test del server e i
 * 61 dell'interfaccia verificano le parti: qui si verifica che siano collegate
 * fra loro — che è esattamente ciò che l'audit iniziale aveva trovato mancante
 * («metà del backend non ha interfaccia»).
 *
 * Deliberatamente un unico test lungo e non nove corti: le fasi dipendono l'una
 * dall'altra (non si può comprare crediti senza averli esauriti) e spezzarle
 * significherebbe ricostruire lo stato con scorciatoie che non passano
 * dall'interfaccia — cioè non verificare più il percorso reale.
 */

/** Invia un messaggio e attende che il turno si chiuda. */
async function sendMessage(page: Page, text: string) {
  const field = page.getByPlaceholder(/^Scrivi a /);
  await field.fill(text);
  await page.getByLabel('Invia messaggio').click();
}

test('percorso completo: dalla registrazione all\'eliminazione dell\'account', async ({ page }) => {
  const id = unique();
  const email = `viaggio-${id}@e2e.test`;
  const username = `viaggio_${id}`;

  // ── 1. Esplora ─────────────────────────────────────────────────────────────
  await page.goto('/discover');
  await expect(page.getByRole('main').getByRole('link', { name: /Aria Thorne/ }).first()).toBeVisible();

  // ── 2. Registrazione ───────────────────────────────────────────────────────
  await registraEConferma(page, email, username);
  await expect(sidebar(page).getByText('10 crediti')).toBeVisible();

  // ── 3. Ricerca: il campo che prima non filtrava nulla (S3-1) ───────────────
  await sidebar(page).getByLabel('Cerca personaggi').fill('marc');
  await sidebar(page).getByLabel('Cerca personaggi').press('Enter');
  await expect(page).toHaveURL(/\/search\?q=marc$/);
  await expect(page.getByRole('main').getByRole('link', { name: /Marcus Vance/ }).first()).toBeVisible();

  // ── 4. Scheda del personaggio: la pagina che mancava del tutto (S3-7) ──────
  await page.getByRole('main').getByRole('link', { name: /Marcus Vance/ }).first().click();
  await expect(page).toHaveURL(/\/character\/650000000000000000000002$/);
  await expect(page.getByRole('heading', { name: 'Marcus Vance' })).toBeVisible();

  // ── 5. La conversazione si apre come azione deliberata, non al primo click ─
  await page.getByRole('button', { name: 'Nuova conversazione' }).click();
  await expect(page).toHaveURL(/\/chat\/[a-f0-9]{24}$/);
  await expect(page.getByText('Hai trenta secondi. Parla.')).toBeVisible();

  const chatUrl = page.url();

  // ── 6. Un messaggio riceve risposta e costa un credito ────────────────────
  await sendMessage(page, 'Chi sei davvero?');
  await expect(page.getByText(/Capisco perfettamente la tua prospettiva/).first()).toBeVisible();
  await expect(sidebar(page).getByText('9 crediti')).toBeVisible();

  // ── 7. Esaurimento dei crediti ─────────────────────────────────────────────
  // Il limite deve arrivare dal server e fermare l'invio: prima una guardia
  // fallita serviva comunque la risposta, gratis (S1-2).
  /**
   * Il pulsante si chiamava «Conferma Acquisto» — maiuscole a caso in mezzo a
   * un'interfaccia che scrive «Invia segnalazione» e «Salva modifiche» — e non
   * diceva quanto si stava per spendere. Ora porta l'importo: l'azione e il suo
   * prezzo nello stesso posto.
   */
  const buyDialog = page.getByRole('button', { name: /^Acquista / });
  for (let i = 0; i < 12 && !(await buyDialog.isVisible()); i++) {
    await sendMessage(page, `Messaggio numero ${i}`);
    await page.waitForTimeout(250);
  }
  
  await expect(buyDialog).toBeVisible();
  await expect(sidebar(page).getByText('0 crediti')).toBeVisible();

  // ── 8. Acquisto ────────────────────────────────────────────────────────────
  // In assenza di chiavi Stripe reali il percorso è quello simulato, e
  // l'interfaccia lo dichiara invece di mostrare il marchio Stripe (S2-9).
  await expect(page.getByText(/Modalità sviluppo — nessun pagamento reale/)).toBeVisible();
  await buyDialog.click();
  await expect(page.getByText(/Crediti accreditati con successo/)).toBeVisible();
  await expect(sidebar(page).getByText('150 crediti')).toBeVisible();

  // ── 9. La conversazione riprende da dove era rimasta ───────────────────────
  await expect(page).toHaveURL(chatUrl);
  await sendMessage(page, 'Riprendiamo il discorso.');
  await expect(sidebar(page).getByText('149 crediti')).toBeVisible();

  // ── 10. La cronologia esiste e la conversazione è riapribile (S3-6) ────────
  await page.goto('/discover');
  const historyLink = sidebar(page).getByRole('link', { name: /Marcus Vance/ }).first();
  await expect(historyLink).toBeVisible();
  await historyLink.click();
  await expect(page).toHaveURL(chatUrl);
  // `exact` è necessario: la risposta simulata cita il messaggio dell'utente,
  // quindi una corrispondenza parziale trova due elementi.
  await expect(page.getByText('Riprendiamo il discorso.', { exact: true })).toBeVisible();

  // ── 11. Eliminazione dell'account: l'endpoint esisteva senza pulsante (S3-8)
  await page.goto('/settings');
  await page.getByRole('button', { name: /Elimina account/ }).click();
  await page.getByLabel('Nome utente per conferma').fill(username);
  // Il nome utente è scritto nella pagina: da solo protegge dalla disattenzione,
  // non da chi ha rubato la sessione. Il server chiede anche la password (S14).
  await page.getByLabel('La tua password').fill('Password1');
  await page.getByRole('button', { name: 'Elimina definitivamente' }).click();

  // ── 12. La sessione è chiusa davvero (S0-8) ───────────────────────────────
  await expect(page).toHaveURL('http://127.0.0.1:5174/');
  await expect(page.getByRole('button', { name: 'Registrati' })).toBeVisible();
  await expect(sidebar(page).getByText(`@${username}`)).not.toBeVisible();
});
