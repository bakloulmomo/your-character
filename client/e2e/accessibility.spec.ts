import { test, expect, type Page } from '@playwright/test';

/**
 * Controlli trasversali su OGNI pagina, a due larghezze.
 *
 * I test end-to-end esistenti seguono percorsi: registrazione, moderazione,
 * galleria. Verificano che le cose funzionino. Restava scoperta un'altra
 * categoria di difetti — quelli che non fanno fallire nulla e si vedono solo
 * guardando: un comando senza nome per uno screen reader, un campo senza
 * etichetta, una pagina che scorre in orizzontale su telefono, un titolo di
 * scheda uguale per tutte le pagine.
 *
 * Sono i difetti che questa revisione ha trovato a mano, uno per uno. Da qui in
 * poi li trova la suite.
 */

const PAGINE: Array<[percorso: string, nome: string]> = [
  // La radice non è più il catalogo: è la presentazione, e ha un guscio
  // proprio (intestazione e piede di pagina invece della barra laterale).
  ['/', 'Presentazione'],
  ['/prezzi', 'Prezzi'],
  ['/faq', 'Domande frequenti'],
  ['/contatti', 'Contatti'],
  ['/cookie-policy', 'Cookie'],
  ['/discover', 'Scopri'],
  ['/search?q=aria', 'Cerca'],
  ['/character/650000000000000000000001', 'Scheda personaggio'],
  ['/create', 'Crea personaggio'],
  ['/profile', 'Profilo'],
  ['/settings', 'Impostazioni'],
  ['/terms', 'Termini'],
  ['/privacy', 'Privacy'],
  ['/rotta-inesistente', 'Pagina non trovata']
];

const CREDENZIALI = {
  email: `a11y_${Date.now()}@e2e.test`,
  username: `a11y_${Date.now()}`,
  password: 'Password123',
  birthdate: '1990-03-12'
};

async function accedi(page: Page) {
  await page.goto('/');
  await page.evaluate(async (c) => {
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(c)
    });
    if (r.status !== 201) {
      await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: c.email, password: c.password })
      });
    }
  }, CREDENZIALI);
}

for (const larghezza of [1440, 390]) {
  test.describe(`a ${larghezza}px`, () => {
    test.use({ viewport: { width: larghezza, height: 900 } });

    test('ogni pagina è navigabile, etichettata e non scorre in orizzontale', async ({ page }) => {
      const erroriPagina: string[] = [];
      page.on('pageerror', (e) => erroriPagina.push(`${page.url()} → ${e.message}`));

      await accedi(page);

      for (const [percorso, nome] of PAGINE) {
        await page.goto(percorso);
        await page.waitForLoadState('networkidle');

        await test.step(`${nome} — nessuno scorrimento orizzontale`, async () => {
          /**
           * Il difetto che questo controllo esiste per impedire: la chat si
           * dimensionava in `100dvh` SOMMANDOSI alla barra superiore mobile,
           * quindi la pagina sporgeva di 57px e il campo di scrittura finiva
           * sotto il bordo dello schermo. Lo stesso genere di errore in
           * orizzontale è ancora più difficile da notare da sviluppatori.
           */
          const eccesso = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth
          );
          expect(eccesso, `${nome} scorre in orizzontale di ${eccesso}px`).toBeLessThanOrEqual(1);
        });

        await test.step(`${nome} — il titolo della scheda identifica la pagina`, async () => {
          // Era una costante in index.html: ogni scheda, ogni segnalibro e ogni
          // voce della cronologia si chiamava «your-character».
          const titolo = await page.title();
          expect(titolo, 'titolo assente').toBeTruthy();
          expect(titolo, 'titolo generico').not.toBe('your-character');
        });

        await test.step(`${nome} — ogni comando ha un nome accessibile`, async () => {
          // Un pulsante o un link con la sola icona dentro viene annunciato come
          // «pulsante», senza dire quale.
          const anonimi = await page.evaluate(() => {
            const nomeDi = (el: Element) =>
              (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim() ||
              (el.querySelector('img')?.getAttribute('alt') || '').trim();
            return [...document.querySelectorAll('button, a[href]')]
              .filter((el) => (el as HTMLElement).offsetParent !== null && !nomeDi(el))
              .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
          });
          expect(anonimi, `comandi senza nome in «${nome}»`).toEqual([]);
        });

        await test.step(`${nome} — ogni campo ha un'etichetta`, async () => {
          // Nel modale di segnalazione due campi non ne avevano: per uno screen
          // reader la finestra conteneva «menu a tendina» e «area di testo».
          const orfani = await page.evaluate(() =>
            [...document.querySelectorAll('input, select, textarea')]
              .filter((el) => {
                const e = el as HTMLElement;
                if (e.offsetParent === null) return false;
                if (el.getAttribute('type') === 'hidden') return false;
                const id = el.getAttribute('id');
                return !(
                  el.getAttribute('aria-label') ||
                  el.getAttribute('aria-labelledby') ||
                  (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) ||
                  el.closest('label')
                );
              })
              .map((el) => `${el.tagName.toLowerCase()}#${el.getAttribute('id') || '(senza id)'}`)
          );
          expect(orfani, `campi senza etichetta in «${nome}»`).toEqual([]);
        });

        await test.step(`${nome} — una sola intestazione di primo livello`, async () => {
          expect(await page.locator('h1').count()).toBeLessThanOrEqual(1);
        });
      }

      expect(erroriPagina, 'eccezioni JavaScript non gestite').toEqual([]);
    });
  });
}

test.describe('navigazione da tastiera', () => {
  test('il primo Tab offre il salto al contenuto', async ({ page }) => {
    /**
     * La barra laterale contiene logo, «Crea», ricerca, voci di navigazione e
     * l'intera cronologia — una voce per conversazione, ciascuna con il proprio
     * pulsante azioni. Senza il salto, raggiungere la pagina da tastiera
     * costava decine di tabulazioni a ogni cambio di pagina.
     */
    await page.goto('/discover');
    await page.keyboard.press('Tab');

    const attivo = await page.evaluate(() => ({
      testo: document.activeElement?.textContent?.trim(),
      href: document.activeElement?.getAttribute('href'),
      visibile: (document.activeElement as HTMLElement)?.getBoundingClientRect().height > 1
    }));

    expect(attivo.testo).toBe('Vai al contenuto');
    expect(attivo.href).toBe('#contenuto');
    // Invisibile finché non ha il focus, visibile appena lo riceve.
    expect(attivo.visibile).toBe(true);
  });
});
