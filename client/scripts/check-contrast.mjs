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

// ── La tavolozza, nella stessa forma in cui sta in tailwind.config.js ────────
export const PALETTE = {
  bg: '#0A0A0C',
  bgElevated: '#0F0F12',
  surface: '#141417',
  surfaceHover: '#1A1A1E',
  surfaceSunken: '#0C0C0E',
  line: '#1F1F24',
  lineStrong: '#34343C',
  ink: '#EDEDF0',
  inkMuted: '#A2A2AC',
  inkDim: '#87878F',
  accent: '#1A6FBE',
  accentHover: '#1F76C4',
  accentGlow: '#63B3F0',
  accentDeep: '#124C82',
  onAccent: '#FFFFFF',
  danger: '#F2555A',
  success: '#2FBF87',
  warning: '#E0A33E'
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

  // Azione principale: testo bianco sul riempimento pieno
  ['bianco su accento', P.onAccent, P.accent, 4.5],
  ['bianco su accento (hover)', P.onAccent, P.accentHover, 4.5],

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

  // Elementi non testuali: soglia 3:1
  ['bordo forte su bg', P.lineStrong, P.bg, 1.5],
  ['accento (bordo di campo) su campo', P.accent, P.surfaceSunken, 3.0],
  ['anello di fuoco su bg', P.accentGlow, P.bg, 3.0],
  ['anello di fuoco su pannello', P.accentGlow, P.bgElevated, 3.0]
];

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
