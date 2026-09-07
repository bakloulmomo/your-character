#!/usr/bin/env node
/**
 * Verifica i contrasti della tavolozza secondo WCAG 2.1.
 *
 * Il progetto aveva già corretto UNA volta un contrasto insufficiente
 * (`ink.dim` era a 4.2:1, sotto il minimo di 4.5:1, proprio sul testo più
 * piccolo dell'interfaccia). La correzione però viveva in un commento: nulla
 * impediva alla successiva revisione del colore di reintrodurre il problema.
 *
 * Qui i rapporti si calcolano. Se una coppia scende sotto la soglia, il
 * controllo fallisce e lo dice — con il valore misurato e quello richiesto.
 *
 * Soglie (WCAG 2.1 AA):
 *   4.5:1  testo normale
 *   3.0:1  testo grande (≥18.66px grassetto o ≥24px) e componenti dell'interfaccia
 */

import { readFileSync } from 'node:fs';

const hex = (h) => {
  const s = h.replace('#', '');
  const n = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
};

/** Luminanza relativa secondo la definizione WCAG. */
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a, b) => {
  const [la, lb] = [luminance(hex(a)), luminance(hex(b))];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

// ── La tavolozza — LETTA dalla configurazione, non ricopiata ────────────────
/**
 * Prima queste diciotto righe erano una trascrizione a mano di
 * `tailwind.config.js`, e nulla teneva insieme le due copie. Un controllo che
 * misura valori diversi da quelli che il browser dipinge non misura niente: la
 * prima modifica al tema che dimenticasse questo file avrebbe lasciato lo
 * script verde su una tavolozza che non esiste piu'.
 *
 * Ora la fonte e' una sola. Se un token sparisce, `richiesto()` lo dice
 * fallendo subito, invece di lasciare `undefined` scorrere fino a un NaN.
 */
import config from '../tailwind.config.js';

const COLORI = config.theme.extend.colors;

const richiesto = (percorso) => {
  const valore = percorso.split('.').reduce((o, k) => (o == null ? o : o[k]), COLORI);
  if (typeof valore !== 'string' || !valore.startsWith('#')) {
    console.error(
      `\n❌ Token assente o non esadecimale in tailwind.config.js: colors.${percorso}\n` +
      `   (letto: ${JSON.stringify(valore)})\n`
    );
    process.exit(1);
  }
  return valore;
};

export const PALETTE = {
  bg: richiesto('bg.DEFAULT'),
  bgElevated: richiesto('bg.elevated'),
  surface: richiesto('surface.DEFAULT'),
  surfaceHover: richiesto('surface.hover'),
  surfaceSunken: richiesto('surface.sunken'),
  line: richiesto('line.DEFAULT'),
  lineStrong: richiesto('line.strong'),
  ink: richiesto('ink.DEFAULT'),
  inkMuted: richiesto('ink.muted'),
  inkDim: richiesto('ink.dim'),
  accent: richiesto('accent.DEFAULT'),
  accentHover: richiesto('accent.hover'),
  accentGlow: richiesto('accent.glow'),
  danger: richiesto('danger'),
  success: richiesto('success'),
  warning: richiesto('warning'),
  /**
   * Il colore del TESTO sul riempimento d'accento.
   *
   * Sull'ambra era il nero della sala (7.54:1), perché col bianco quella
   * coppia dava 2.42:1. Con l'accento tornato al blu del marchio la misura si
   * ribalta: il nero dà 3.93:1 e non passa, l'inchiostro 4.64:1 sì. Il
   * pulsante primario porta quindi testo chiaro — è la stessa riga di
   * `index.css` che lo dice (`btn-primary { @apply text-ink }`), e la coppia
   * qui sotto è ciò che impedisce alle due di divergere.
   */
  onAccent: richiesto('ink.DEFAULT')
};

const P = PALETTE;

/**
 * Ogni coppia che l'interfaccia produce davvero.
 *
 * `min` è la soglia che si applica a QUELLA coppia: 4.5 dove è testo normale,
 * 3.0 dove è testo grande o un elemento non testuale (bordi di campi, anelli
 * di fuoco, indicatori). Dichiararla coppia per coppia evita sia di far
 * passare un testo piccolo con la soglia dei componenti, sia di bocciare un
 * bordo pretendendo da lui la soglia del testo.
 */
const PAIRS = [
  // Testo sui tre fondi su cui compare davvero
  ['ink su bg', P.ink, P.bg, 4.5],
  ['ink su superficie', P.ink, P.surface, 4.5],
  ['ink su pannello', P.ink, P.bgElevated, 4.5],
  ['ink su campo', P.ink, P.surfaceSunken, 4.5],
  ['ink-muted su bg', P.inkMuted, P.bg, 4.5],
  ['ink-muted su superficie', P.inkMuted, P.surface, 4.5],
  ['ink-muted su pannello', P.inkMuted, P.bgElevated, 4.5],
  // `ink.dim` e' il colore del testo PIU' PICCOLO dell'interfaccia (11px):
  // e' la coppia in cui un errore di contrasto si sente di piu', ed e' quella
  // che era gia' stata sbagliata una volta.
  ['ink-dim su bg', P.inkDim, P.bg, 4.5],
  ['ink-dim su superficie', P.inkDim, P.surface, 4.5],
  ['ink-dim su campo', P.inkDim, P.surfaceSunken, 4.5],

  // Azione principale: il testo del pulsante sul riempimento pieno
  ['testo su accento', P.onAccent, P.accent, 4.5],
  ['testo su accento (hover)', P.onAccent, P.accentHover, 4.5],

  // Collegamenti e testo d'accento sui fondi scuri
  ['accento-glow su bg', P.accentGlow, P.bg, 4.5],
  ['accento-glow su superficie', P.accentGlow, P.surface, 4.5],
  ['accento-glow su pannello', P.accentGlow, P.bgElevated, 4.5],

  // Stati semantici, sempre come TESTO su fondo scuro
  ['danger su bg', P.danger, P.bg, 4.5],
  ['danger su superficie', P.danger, P.surface, 4.5],
  ['danger su pannello', P.danger, P.bgElevated, 4.5],
  ['success su bg', P.success, P.bg, 4.5],
  ['success su superficie', P.success, P.surface, 4.5],
  ['warning su bg', P.warning, P.bg, 4.5],
  ['warning su superficie', P.warning, P.surface, 4.5],

  // Elementi non testuali: soglia 3:1 (WCAG 1.4.11)
  //
  // `line` e `line.strong` NON sono qui, e la ragione va scritta perche' la
  // versione precedente li teneva dentro con la soglia abbassata a 1.5 — un
  // numero senza fondamento, scelto per far passare un colore che a 3.0 non
  // passava. Abbassare la soglia non e' verificare: e' spegnere il controllo
  // lasciandone acceso l'aspetto.
  //
  // La risposta onesta e' che quei due token fanno DUE mestieri diversi, e solo
  // uno ricade sotto WCAG 1.4.11. Separare un blocco dal successivo e'
  // decorazione: se il filo sparisse, il contenuto resterebbe comprensibile.
  // Disegnare il bordo di un campo o di un pulsante non lo e': li' la linea e'
  // l'unica cosa che dice dove si puo' scrivere o premere.
  //
  // Il secondo mestiere ha quindi un token suo, `line.control`, che la soglia
  // la rispetta davvero.
  ['bordo di controllo su bg', richiesto('line.control'), P.bg, 3.0],
  ['bordo di controllo su campo', richiesto('line.control'), P.surfaceSunken, 3.0],
  ['accento (bordo di campo) su campo', P.accent, P.surfaceSunken, 3.0],
  ['anello di fuoco su bg', P.accentGlow, P.bg, 3.0],
  ['anello di fuoco su pannello', P.accentGlow, P.bgElevated, 3.0]
];

/**
 * Le tinte di ripiego degli avatar — LETTE da `src/lib/format.ts`.
 *
 * Erano l'ultimo colore dell'interfaccia fuori da questo controllo: il fondo
 * dell'avatar senza immagine è calcolato in JavaScript da `tintFor()`, quindi
 * non passa da Tailwind e nessuna delle 27 coppie lo toccava. Sono otto colori
 * che portano del testo, e il testo su un colore non verificato è testo non
 * verificato — «è solo un ripiego» non è una ragione per un contrasto scarso,
 * ed è anzi il caso in cui capita più spesso.
 *
 * Si estraggono dal sorgente invece di ricopiarle qui: la trascrizione a mano
 * è l'errore che questo stesso file aveva con la tavolozza.
 */
const sorgenteTinte = readFileSync(new URL('../src/lib/format.ts', import.meta.url), 'utf8');
const blocco = sorgenteTinte.match(/const palette = \[([\s\S]*?)\]/);
if (!blocco) {
  console.error('\n❌ Non trovo `const palette = [...]` in src/lib/format.ts.\n');
  process.exit(1);
}
const TINTE = [...blocco[1].matchAll(/'(#[0-9A-Fa-f]{6})'/g)].map((m) => m[1]);
if (TINTE.length === 0) {
  console.error('\n❌ La tavolozza degli avatar in src/lib/format.ts è vuota.\n');
  process.exit(1);
}
// Le iniziali sono testo grande (≥ 36% del lato), quindi la soglia è 3.0.
for (const tinta of TINTE) {
  PAIRS.push([`iniziali su avatar ${tinta}`, P.ink, tinta, 3.0]);
}

let failed = 0;
const rows = PAIRS.map(([name, fg, bg, min]) => {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failed++;
  return { name, r, min, ok };
});

const width = Math.max(...rows.map((r) => r.name.length));
for (const { name, r, min, ok } of rows) {
  const mark = ok ? '[32m✓[0m' : '[31m✗[0m';
  const value = r.toFixed(2).padStart(5);
  console.log(`  ${mark} ${name.padEnd(width)}  ${value}:1  (min ${min.toFixed(1)})`);
}

/**
 * La scala di elevazione deve restare MONOTONA: ogni gradino piu' chiaro del
 * precedente. Non e' un vezzo — quando `surface.sunken` era piu' CHIARO del
 * fondo pagina, un campo di testo «incassato» sporgeva invece di rientrare, e
 * la profondita' comunicava il contrario di quello che intendeva.
 */
const LADDER = [
  ['bg', P.bg],
  ['surface.sunken', P.surfaceSunken],
  ['bg.elevated', P.bgElevated],
  ['surface', P.surface],
  ['surface.hover', P.surfaceHover]
];

console.log('\n  Scala di elevazione (luminanza crescente):');
let previous = -1;
let ladderBroken = false;
for (const [name, value] of LADDER) {
  const l = luminance(hex(value));
  const ok = l > previous;
  if (!ok) ladderBroken = true;
  console.log(`  ${ok ? '[32m✓[0m' : '[31m✗[0m'} ${name.padEnd(width)}  ${value}  L=${l.toFixed(4)}`);
  previous = l;
}

if (failed > 0 || ladderBroken) {
  console.error(
    `\n❌ ${failed} coppie sotto la soglia${ladderBroken ? ' e la scala di elevazione non e\' monotona' : ''}.\n`
  );
  process.exit(1);
}

console.log(`\n✅ ${rows.length} coppie di contrasto verificate, scala di elevazione monotona.\n`);
