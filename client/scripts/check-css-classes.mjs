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
  'eyebrow', 'field-shell', 'hover-action'
];

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const sourceFiles = walk(SRC).filter((f) => ['.tsx', '.ts'].includes(extname(f)));

// Classi usate nel sorgente
const used = new Map();
for (const file of sourceFiles) {
  const content = readFileSync(file, 'utf8');
  for (const match of content.matchAll(/class(?:Name)?=["'`]([^"'`]+)["'`]/g)) {
    for (const token of match[1].split(/\s+/)) {
      const cls = token.replace(/^[a-z-]+:/, '').trim();
      if (CUSTOM_PREFIXES.some((p) => cls.startsWith(p))) {
        if (!used.has(cls)) used.set(cls, []);
        used.get(cls).push(file);
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
