#!/usr/bin/env node
/**
 * Il gate anti-deriva.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Perché esiste, e perché è il pezzo più importante del sistema di design.
 *
 * «Rivista» non è fallito per mancanza di regole: le regole erano scritte, in
 * quaranta righe di manifesto in testa a `tailwind.config.js`, ed erano buone.
 * È fallito perché nulla le applicava. Alla fine il conto era questo:
 *
 *   · 8 pagine componevano il titolo con `font-display text-2xl font-bold`,
 *     una misura che non apparteneva nemmeno alla scala, contro 1 sola pagina
 *     allineata al sistema
 *   · 29 usi di corpi fuori scala e 5 misure arbitrarie scritte a mano
 *     (`text-[0.8125rem]`, che è IDENTICO a `text-sm`)
 *   · 4 pagine usavano le pastiglie colorate che i commenti del codice
 *     dichiaravano abolite
 *   · `display-md` non era mai stato usato da nessuno
 *
 * Un'interfaccia si legge come «generata» proprio così: non per una brutta
 * tavolozza, ma per lo scarto fra la regola dichiarata e il codice che la
 * contraddice. La coerenza non si ottiene con la buona volontà di chi scrive
 * la prossima pagina — si ottiene rendendo la deriva impossibile.
 *
 * Le misure ammesse e i colori ammessi si LEGGONO da `tailwind.config.js`:
 * aggiungere un gradino alla scala lo rende automaticamente valido qui, e
 * toglierlo lo rende automaticamente un errore.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import config from '../tailwind.config.js';
import { classiUsate } from './lib/classi.mjs';

const estensione = config.theme.extend;
const CORPI = new Set(Object.keys(estensione.fontSize));
const COLORI = new Set(Object.keys(estensione.colors));
const OMBRE = new Set([...Object.keys(estensione.boxShadow), 'none']);

/** Le misure che Tailwind offre di suo e che la scala del progetto non ha. */
const CORPI_PREDEFINITI = new Set(
  ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl']
);

/** Le tavolozze predefinite di Tailwind: nessuna appartiene a «Notturno». */
const TAVOLOZZE_PREDEFINITE = new Set([
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow',
  'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet',
  'purple', 'fuchsia', 'pink', 'rose'
]);

/** Utilità `text-*` che non sono né un corpo né un colore. */
const TESTO_NON_COLORE = new Set([
  'left', 'center', 'right', 'justify', 'start', 'end',
  'wrap', 'nowrap', 'balance', 'pretty', 'ellipsis', 'clip',
  'transparent', 'current', 'inherit'
]);

/** Proprietà che prendono un colore. */
const PREFISSI_COLORE = [
  'bg', 'text', 'border', 'fill', 'stroke', 'ring', 'ring-offset', 'divide',
  'placeholder', 'caret', 'decoration', 'outline', 'from', 'via', 'to', 'accent'
];

const violazioni = [];
const segnala = (v, motivo, rimedio) =>
  violazioni.push({ ...v, motivo, rimedio });

for (const uso of classiUsate('src')) {
  // Via le varianti (`md:`, `hover:`, `group-hover:`, `focus-visible:`…) e
  // l'eventuale `!` di importanza: restano la proprietà e il valore.
  const cls = uso.cls.replace(/^(?:[a-zA-Z0-9@[\]().<>_-]+:)+/, '').replace(/^!/, '');
  // Via il modificatore d'opacità: `bg-danger/10` è `bg-danger`.
  const base = cls.split('/')[0];
  const v = { ...uso, cls };

  if (!base) continue;

  // ── Un esadecimale scritto a mano, ovunque compaia ───────────────────────
  if (/\[#[0-9a-fA-F]{3,8}\]/.test(base) || /\[(?:rgb|hsl)a?\(/.test(base)) {
    segnala(v, 'colore scritto a mano', 'usa un token di colors in tailwind.config.js');
    continue;
  }

  // ── Corpo del testo ──────────────────────────────────────────────────────
  const corpo = base.match(/^text-(.+)$/);
  if (corpo) {
    const valore = corpo[1];
    if (/^\[.+\]$/.test(valore)) {
      segnala(v, 'corpo arbitrario', `usa un gradino di fontSize (${[...CORPI].join(', ')})`);
      continue;
    }
    if (CORPI_PREDEFINITI.has(valore) && !CORPI.has(valore)) {
      segnala(v, 'corpo fuori scala', `${valore} non è nella scala: usa display-sm/md/lg/xl o base/read`);
      continue;
    }
  }

  // ── Ombre ────────────────────────────────────────────────────────────────
  if (base === 'shadow' || base.startsWith('shadow-')) {
    const valore = base === 'shadow' ? 'DEFAULT' : base.slice('shadow-'.length);
    // `shadow-<colore>` è un'altra cosa e viene giudicata più sotto.
    const eColore = COLORI.has(valore.split('-')[0]);
    if (!eColore && !OMBRE.has(valore)) {
      segnala(v, 'ombra fuori token', `usa shadow-overlay o shadow-popover`);
      continue;
    }
  }

  // ── Colori ───────────────────────────────────────────────────────────────
  for (const prefisso of PREFISSI_COLORE) {
    if (!base.startsWith(`${prefisso}-`)) continue;
    const valore = base.slice(prefisso.length + 1);
    const famiglia = valore.split('-')[0];

    if (prefisso === 'text' && (TESTO_NON_COLORE.has(valore) || CORPI.has(valore) || CORPI_PREDEFINITI.has(valore))) break;
    if (valore === 'white' || valore === 'black') {
      segnala(v, `${valore} non è un token`, 'usa ink (chiaro) o bg (scuro)');
      break;
    }
    if (TAVOLOZZE_PREDEFINITE.has(famiglia)) {
      segnala(v, 'tavolozza predefinita di Tailwind', `«${famiglia}» non appartiene a Notturno`);
      break;
    }
    break;
  }
}

if (violazioni.length > 0) {
  console.error(`\n❌ ${violazioni.length} violazioni del sistema di design:\n`);
  const larghezza = Math.max(...violazioni.map((v) => v.cls.length));
  for (const { cls, file, riga, motivo, rimedio } of violazioni) {
    console.error(`   ${cls.padEnd(larghezza)}  ${motivo}`);
    console.error(`   ${' '.repeat(larghezza)}  ${file}:${riga} — ${rimedio}\n`);
  }
  process.exit(1);
}

console.log('✅ Nessun corpo fuori scala, nessun colore fuori tavolozza, nessuna ombra fuori token.');
