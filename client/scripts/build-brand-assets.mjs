#!/usr/bin/env node
/**
 * Genera gli asset di marca dalla SOLA sorgente che li descrive: `favicon.svg`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Perché uno script e non sei file disegnati a mano.
 *
 * Un set di icone è la cosa che diverge per prima. Il marchio cambia, si
 * aggiorna il favicon perché è quello che si vede, e l'icona dell'app resta
 * indietro per mesi senza che nessuno se ne accorga — la si guarda solo dopo
 * averla installata. Qui l'unica sorgente è `public/favicon.svg`: tutto il
 * resto è prodotto da questa, quindi non può essere vecchio.
 *
 * Il rendering lo fa un browser vero (Playwright, già dipendenza del progetto
 * per i test end-to-end). Non serve né `sharp` né ImageMagick, e soprattutto
 * i PNG escono identici a ciò che il browser disegnerà davvero — un
 * rasterizzatore diverso avrebbe altre regole per il tratto e le maschere.
 *
 * Si esegue a mano quando il marchio cambia:  npm run brand
 * L'esito va committato: la build non deve dipendere da un browser.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const QUI = dirname(fileURLToPath(import.meta.url));
const PUBBLICO = join(QUI, '..', 'public');
const MODULI = join(QUI, '..', 'node_modules');

const SVG = readFileSync(join(PUBBLICO, 'favicon.svg'), 'utf8');

/** Gli stessi token di `tailwind.config.js`. */
const BG = '#08080B';
const INK = '#F4F4F7';
const INK_MUTED = '#9E9DA8';
const ACCENT = '#0D60FE';

/** Il carattere display, incorporato: lo script non deve dipendere dalla rete. */
const ARCHIVO = readFileSync(
  join(MODULI, '@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2')
).toString('base64');
const SCHIBSTED = readFileSync(
  join(MODULI, '@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2')
).toString('base64');

const CARATTERI = `
  @font-face {
    font-family: 'Archivo Variable';
    src: url(data:font/woff2;base64,${ARCHIVO}) format('woff2-variations');
    font-weight: 100 900; font-stretch: 62% 125%;
  }
  @font-face {
    font-family: 'Schibsted Grotesk Variable';
    src: url(data:font/woff2;base64,${SCHIBSTED}) format('woff2-variations');
    font-weight: 400 900;
  }`;

/**
 * Il marchio forzato su un tema.
 *
 * `favicon.svg` sceglie il neutro con `prefers-color-scheme`, ma un PNG non
 * può cambiare idea dopo essere stato scritto: qui il colore si fissa.
 */
const marchio = (neutro) =>
  SVG.replace(/<style>[\s\S]*?<\/style>/, `<style>.yc-neutro { stroke: ${neutro}; }</style>`);

/**
 * Un'icona d'app sta su un fondo pieno e dentro un'AREA SICURA.
 *
 * Android ritaglia le icone «maskable» in forme diverse a seconda del
 * produttore — cerchio, goccia, quadrato stondato — e può togliere fino al 20%
 * per lato. Il marchio occupa quindi il 56% centrale: qualunque ritaglio
 * ragionevole lo lascia intero. Su un'icona che riempie il quadrato, metà
 * delle installazioni Android avrebbe le code dei fumetti tagliate.
 */
const paginaIcona = (lato) => `<!doctype html>
  <body style="margin:0;width:${lato}px;height:${lato}px;background:${BG};display:grid;place-items:center">
    <div style="width:${Math.round(lato * 0.56)}px;height:${Math.round(lato * 0.56)}px">${marchio(INK)}</div>
  </body>`;

const paginaTrasparente = (lato) => `<!doctype html>
  <body style="margin:0;width:${lato}px;height:${lato}px">
    <div style="width:${lato}px;height:${lato}px">${marchio(INK)}</div>
  </body>`;

/**
 * L'anteprima social: 1200×630, la misura che tutti ritagliano allo stesso modo.
 *
 * Oggi `og:image` punta al JPEG del logo — quadrato, con la scacchiera dentro —
 * quindi un link condiviso mostrava un quadratino con un reticolo grigio.
 * L'anteprima è spesso la prima cosa che una persona vede del prodotto, prima
 * ancora del sito: vale la stessa cura di una pagina.
 */
const paginaSocial = () => `<!doctype html>
  <style>${CARATTERI}</style>
  <body style="margin:0;width:1200px;height:630px;background:${BG};
               display:flex;flex-direction:column;justify-content:center;gap:34px;padding:0 96px;
               font-family:'Schibsted Grotesk Variable',sans-serif">
    <div style="display:flex;align-items:center;gap:26px">
      <div style="width:96px;height:96px">${marchio(INK)}</div>
      <span style="font-family:'Archivo Variable';font-weight:700;font-stretch:80%;
                   font-size:60px;letter-spacing:-0.02em;color:${INK}">your-character</span>
    </div>

    <div style="height:1px;background:#201F28"></div>

    <p style="margin:0;font-family:'Archivo Variable';font-weight:700;font-stretch:80%;
              font-size:76px;line-height:1.03;letter-spacing:-0.028em;color:${INK};max-width:21ch">
      Scegli con chi parlare
    </p>
    <p style="margin:0;font-size:30px;line-height:1.45;color:${INK_MUTED};max-width:54ch">
      Crea un personaggio, dagli una personalità e conversaci.
      <span style="color:${ACCENT}">Le tue conversazioni restano tue.</span>
    </p>
  </body>`;

const LAVORI = [
  { nome: 'favicon-32.png', lato: 32, pagina: paginaTrasparente(32), trasparente: true },
  { nome: 'apple-touch-icon.png', lato: 180, pagina: paginaIcona(180) },
  { nome: 'icon-192.png', lato: 192, pagina: paginaIcona(192) },
  { nome: 'icon-512.png', lato: 512, pagina: paginaIcona(512) },
  { nome: 'og-image.png', lato: 1200, altezza: 630, pagina: paginaSocial() }
];

const browser = await chromium.launch();
try {
  for (const { nome, lato, altezza, pagina, trasparente } of LAVORI) {
    const page = await browser.newPage({
      viewport: { width: lato, height: altezza ?? lato },
      deviceScaleFactor: 1
    });
    await page.setContent(pagina);
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot({ omitBackground: !!trasparente });
    writeFileSync(join(PUBBLICO, nome), png);
    await page.close();
    console.log(`  ${nome.padEnd(22)} ${lato}×${altezza ?? lato}  ${(png.length / 1024).toFixed(1)} KB`);
  }
} finally {
  await browser.close();
}

console.log('\n✅ Asset di marca generati da public/favicon.svg');
