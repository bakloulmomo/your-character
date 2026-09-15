import { test, expect } from '@playwright/test';
import { unique, sidebar, registraEConferma } from './aiuti';

/**
 * Le conferme prima di ciò che non si annulla.
 *
 * Tre azioni irreversibili avvenivano al primo click, e nessuna delle tre
 * chiedeva niente: eliminare un turno di conversazione, eliminare un'intera
 * conversazione dal menu della barra laterale, disconnettersi. Le prime due
 * sono raggiunte da icone piccole e vicine ad altre icone — «elimina» sta
 * accanto a «copia» e «rigenera», e su telefono sono tutte sempre visibili.
 *
 * Qui si verificano le due metà che contano davvero: che rinunciare NON faccia
 * nulla, e che confermare faccia esattamente una cosa. La prima è quella che
 * si dimentica di provare, ed è quella che protegge.
 */

test('eliminare un messaggio chiede conferma, e rinunciare non elimina niente', async ({ page }) => {
  const id = unique();
  const testo = `Un messaggio da eliminare ${id}`;

  await page.goto('/discover');
  await registraEConferma(page, `conferma-${id}@e2e.test`, `conferma_${id}`);

  // Una conversazione con un personaggio del catalogo.
  await page.goto('/character/650000000000000000000001');
  await page.getByRole('button', { name: /Nuova conversazione/ }).click();

  const campo = page.getByPlaceholder(/^Scrivi a /);
  await expect(campo).toBeVisible();
  await campo.fill(testo);
  await page.getByLabel('Invia messaggio').click();

  /**
   * `exact: true`, e non è pignoleria.
   *
   * La risposta del personaggio CITA il messaggio dell'utente, quindi un
   * confronto per sottostringa trova due turni: quello scritto e quello che lo
   * ripete. Il locator finirebbe in ambiguità e le asserzioni «è sparito»
   * fallirebbero sull'eco invece che sull'originale. Il confronto esatto guarda
   * l'intero contenuto testuale dell'elemento, che nella citazione è più lungo.
   */
  const messaggio = page.getByText(testo, { exact: true });
  await expect(messaggio).toBeVisible();

  // Nella pagina c'è un pulsante «Elimina messaggio» per ogni turno: questo è
  // quello del turno che contiene esattamente il nostro testo.
  const turno = page.locator('div.group').filter({ has: page.getByText(testo, { exact: true }) });
  await expect(turno).toHaveCount(1);
  const elimina = turno.getByRole('button', { name: 'Elimina messaggio' });

  // ── Rinuncia: il messaggio resta ─────────────────────────────────────────
  await elimina.click();
  await expect(page.getByText(/Sei sicuro di voler eliminare questo messaggio\?/)).toBeVisible();
  await page.getByRole('button', { name: 'Annulla' }).click();
  await expect(messaggio).toBeVisible();

  // ── Conferma: sparisce, e resta sparito dopo un ricaricamento ────────────
  await elimina.click();
  await page.getByRole('button', { name: 'Cancella' }).click();
  await expect(messaggio).toHaveCount(0);

  // Il ricaricamento è la parte che conta: dice che è sparito dal DATABASE, non
  // solo dallo stato locale della pagina.
  await page.reload();
  await expect(page.getByPlaceholder(/^Scrivi a /)).toBeVisible();
  await expect(page.getByText(testo, { exact: true })).toHaveCount(0);
});

test('disconnettersi chiede conferma, e non è dipinto di rosso', async ({ page }) => {
  const id = unique();
  const username = `uscita_${id}`;

  await page.goto('/discover');
  await registraEConferma(page, `uscita-${id}@e2e.test`, username);

  await page.getByRole('button', { name: new RegExp(`@${username}`) }).click();
  await page.getByRole('menuitem', { name: /Disconnetti/ }).click();

  await expect(page.getByText(/Vuoi disconnetterti\?/)).toBeVisible();

  // Rinunciare lascia la sessione dov'era.
  await page.getByRole('button', { name: 'Resta connesso' }).click();
  await expect(sidebar(page).getByText(`@${username}`)).toBeVisible();

  await page.getByRole('button', { name: new RegExp(`@${username}`) }).click();
  await page.getByRole('menuitem', { name: /Disconnetti/ }).click();
  await page.getByRole('button', { name: 'Disconnetti', exact: true }).click();

  await expect(sidebar(page).getByRole('button', { name: 'Registrati' })).toBeVisible();
});
