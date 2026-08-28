import { test, expect } from '@playwright/test';

/**
 * Verifica che l'impalcatura regga: se questo fallisce, il problema è
 * l'ambiente di test, non il prodotto — e distinguerlo subito fa risparmiare
 * un'ora di diagnosi sbagliata.
 */
test('la galleria carica i personaggi dall\'API reale', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Aria Thorne/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Marcus Vance/ }).first()).toBeVisible();
});

