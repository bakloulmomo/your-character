/**
 * Raccolta delle classi scritte negli attributi `class`/`className`.
 *
 * Vive qui, e non dentro uno dei due controlli, perché entrambi ne hanno
 * bisogno e due copie di una scansione divergono. È esattamente l'errore che
 * `check-contrast.mjs` aveva con la tavolozza: una trascrizione a mano che
 * nessuno teneva allineata alla fonte.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

export const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

/**
 * Letterali di stringa e di template, con le sequenze di escape gestite.
 *
 * Scritta a mano, la scansione inciampava sugli apostrofi: in un progetto in
 * italiano `l'utente` dentro una stringa a doppi apici faceva partire una
 * ricerca del successivo apice singolo, che finiva righe più in là e portava
 * dentro spazzatura.
 */
const LETTERALE = /`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;

/**
 * L'attributo, comunque sia scritto.
 *
 * La versione precedente pretendeva la virgoletta SUBITO dopo l'uguale, quindi
 * non vedeva nessuna delle trentanove `className={...}` con la graffa — cioè
 * tutte quelle condizionali, che sono esattamente quelle in cui è più facile
 * sbagliare una classe.
 */
const ATTRIBUTO = /class(?:Name)?=(\{|["'])/g;

function letteraliDa(content, from) {
  let regione;

  if (content[from] === '{') {
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

/**
 * Ogni classe usata, con il file e la riga in cui compare.
 *
 * Restituisce le classi GREZZE, varianti comprese: chi chiama decide se
 * togliere `md:` o `hover:`, perché i due controlli hanno bisogni diversi.
 */
/**
 * Cancella i commenti prima della scansione.
 *
 * Serve, e la prova è che il controllo si è auto-segnalato: `ui/Page.tsx`
 * documenta il pattern che sostituisce citandolo — `<h1 className="font-display
 * text-2xl font-bold">` — e il gate ha giudicato la citazione come una
 * violazione. Un controllo che accusa la propria documentazione viene disatteso
 * la seconda volta che succede, e da lì in poi non protegge più niente.
 *
 * Si cammina il file una volta sola tenendo conto di dove ci si trova: dentro
 * una stringa un `//` è testo (gli URL ne sono pieni), fuori è un commento.
 */
function senzaCommenti(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];

    // Le newline dei commenti si conservano: i numeri di riga riportati
    // devono restare quelli del file vero, altrimenti il messaggio d'errore
    // manda chi legge nel punto sbagliato.
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const fine = c;
      out += c;
      i++;
      while (i < src.length && src[i] !== fine) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        i++;
      }
      out += fine;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function classiUsate(src = 'src') {
  const files = walk(src).filter((f) => ['.tsx', '.ts'].includes(extname(f)));
  const out = [];

  for (const file of files) {
    const originale = readFileSync(file, 'utf8');
    const content = senzaCommenti(originale);
    for (const match of content.matchAll(ATTRIBUTO)) {
      const from = match.index + match[0].length - 1;
      const riga = content.slice(0, from).split('\n').length;
      for (const literal of letteraliDa(content, from)) {
        for (const token of literal.split(/\s+/)) {
          const cls = token.trim();
          if (cls) out.push({ cls, file, riga });
        }
      }
    }
  }
  return out;
}
