#!/usr/bin/env node
/**
 * Verifica che ogni classe CSS usata nel codice esista davvero.
 *
 * L'audit aveva trovato 5 classi inesistenti usate in 14 punti
 * (`animate-fade-in`, `animate-shake`, `scrollbar-none`, `glass-panel`,
 * `glass-card`): transizioni e pannelli semplicemente non venivano applicati e
 * nulla se ne accorgeva. Questo controllo confronta le classi personalizzate
 * usate nel sorgente con quelle realmente prodotte nel CSS compilato.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const SRC = 'src';
const DIST = 'dist/assets';

/** Prefissi delle classi personalizzate del progetto (non utilità Tailwind). */
const CUSTOM_PREFIXES = [
  'glass-', 'btn-', 'card-', 'input-', 'animate-', 'scrollbar-',
  // Aggiunte con la revisione del design system: se una di queste sparisce
  // dal CSS mentre resta nel codice, il controllo deve accorgersene come per
  // le altre.
  'eyebrow', 'field-shell', 'hover-action',
  // Aggiunte con la revisione «Inchiostro».
  'fade-edge-r', 'tabular',
  // Aggiunte con «Notturno». `title-serif` è uscita insieme al serif.
  'title-display', 'portrait', 'rule', 'scrim'
];

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const sourceFiles = walk(SRC).filter((f) => ['.tsx', '.ts'].includes(extname(f)));

// Classi usate nel sorgente
/**
 * Il punto cieco che questo controllo aveva, ed era largo.
 *
 * L'espressione precedente era `class(?:Name)?=["'`]([^"'`]+)["'`]`: pretendeva
 * la virgoletta SUBITO dopo l'uguale. Ma il codice scrive `className={...}` con
 * la graffa in trentanove punti — cioè in tutti quelli in cui la classe è
 * condizionale, che sono esattamente quelli in cui è più facile sbagliarla. Il
 * controllo esisteva per impedire le classi fantasma e non guardava dove le
 * classi fantasma nascono.
 *
 * Ora si raccolgono TUTTI i letterali di stringa e di template che stanno
 * dentro un attributo `class`/`className`, comunque sia scritto. Le
 * interpolazioni `${...}` di un template non sono ispezionabili staticamente e
 * vengono saltate: quello che resta sono le porzioni letterali, che sono ciò
 * che ci interessa.
 */
const ATTRIBUTO = /class(?:Name)?=(\{|["'])/g;

/**
 * Letterali di stringa e di template, con le sequenze di escape gestite.
 *
 * Scritta a mano, la scansione inciampava sugli apostrofi: in un progetto in
 * italiano `l'utente` dentro una stringa a doppi apici faceva partire una
 * ricerca del successivo apice singolo, che finiva righe più in là e portava
 * dentro spazzatura. Qui l'alternanza è ordinata e ogni alternativa consuma i
 * propri escape, quindi un apice dentro un letterale delimitato da altro non
 * viene mai scambiato per un delimitatore.
 */
const LETTERALE = /`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;

/** Estrae i letterali dall'espressione che segue `className=`. */
function letteraliDa(content, from) {
  let regione;

  if (content[from] === '{') {
    // Si scorre fino alla graffa di chiusura bilanciata. Le interpolazioni
    // `${...}` di un template aprono e chiudono, quindi tornano in pari.
    let depth = 0;
    let i = from;
    for (; i < content.length; i++) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}' && --depth === 0) break;
    }
    regione = content.slice(from, i);
  } else {
    const fine = content.indexOf(content[from], from + 1);
    regione = fine === -1 ? '' : content.slice(from, fine + 1);
  }

  return [...regione.matchAll(LETTERALE)].map((m) =>
    // Le interpolazioni non sono ispezionabili staticamente: restano le parti
    // scritte a mano, che sono quelle che ci interessano.
    m[0].slice(1, -1).replace(/\$\{[^}]*\}/g, ' ')
  );
}

const used = new Map();
for (const file of sourceFiles) {
  const content = readFileSync(file, 'utf8');
  for (const match of content.matchAll(ATTRIBUTO)) {
    for (const literal of letteraliDa(content, match.index + match[0].length - 1)) {
      for (const token of literal.split(/\s+/)) {
        const cls = token.replace(/^[a-z-]+:/, '').trim();
        if (CUSTOM_PREFIXES.some((p) => cls.startsWith(p))) {
          if (!used.has(cls)) used.set(cls, []);
          used.get(cls).push(file);
        }
      }
    }
  }
}

if (!existsSync(DIST)) {
  console.error('❌ Nessun CSS compilato in dist/. Esegui prima "npm run build".');
  process.exit(1);
}

const cssFile = readdirSync(DIST).find((f) => f.endsWith('.css'));
const css = readFileSync(join(DIST, cssFile), 'utf8');

const missing = [];
for (const [cls, files] of used) {
  // Le animazioni compaiono nel CSS come `animation:<nome>`; le altre come selettore.
  const asSelector = css.includes(`.${cls.replace(/[^\w-]/g, '\\$&')}`) || css.includes(`.${cls}`);
  if (!asSelector) missing.push({ cls, files: [...new Set(files)] });
}

if (missing.length > 0) {
  console.error('\n❌ Classi CSS usate nel codice ma NON presenti nel CSS compilato:\n');
  for (const { cls, files } of missing) {
    console.error(`   .${cls}`);
    files.forEach((f) => console.error(`      usata in ${f}`));
  }
  console.error('\nDefiniscile in index.css o tailwind.config.js, oppure rimuovine l\'uso.\n');
  process.exit(1);
}

console.log(`✅ Tutte le ${used.size} classi personalizzate usate esistono nel CSS compilato.`);
