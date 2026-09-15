#!/usr/bin/env node
/**
 * Conferma d'ufficio gli account creati PRIMA che la verifica esistesse.
 *
 *   MONGODB_URI="<uri>" node scripts/grandfatherVerified.js --dry-run
 *   MONGODB_URI="<uri>" node scripts/grandfatherVerified.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PERCHE' UNO SCRIPT E NON UNA RIGA DI CODICE.
 *
 * Serviva un modo di dire «questi account valgono come confermati». La strada
 * facile sarebbe stata una condizione nel modello — «se `createdAt` e'
 * anteriore al lancio, considerali verificati» — e sarebbe stata la scelta
 * sbagliata: quella riga resta nel codice per sempre, la data diventa una
 * costante magica che nessuno ricorda piu' come giustificare, e da qualche
 * parte c'e' un ramo che apre il cancello in base a un confronto di date.
 *
 * Una decisione presa UNA VOLTA si esegue una volta e si annota. Dopo,
 * `emailVerifiedAt` significa esattamente una cosa in tutto il sistema: che
 * qualcuno ha dimostrato di leggere quella casella, o che noi abbiamo deciso
 * di fidarci — e nel secondo caso c'e' scritto in `DEPLOY.md` quando e perche'.
 *
 * QUANDO E' LEGITTIMO USARLO. Sulla beta chiusa: gli account sono pochi, sono
 * entrati con un codice d'invito, e chiedere a tutti di riconfermare
 * l'indirizzo dopo mesi d'uso significherebbe perderne una parte per un
 * requisito introdotto dopo. NON e' legittimo dopo l'apertura al pubblico: da
 * li' in poi ogni indirizzo si conferma da solo.
 *
 * `--dry-run` PRIMA. Sempre. E' una scrittura di massa su utenti veri.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../models/User');

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/your-character';
  await mongoose.connect(uri);

  const filtro = { emailVerifiedAt: null };
  const quanti = await User.countDocuments(filtro);

  if (quanti === 0) {
    console.log('\nNessun account da confermare: tutti hanno gia\' un indirizzo verificato.\n');
    return;
  }

  const elenco = await User.find(filtro).select('email username createdAt').sort({ createdAt: 1 }).lean();

  console.log(`\n${quanti} account senza conferma:\n`);
  for (const u of elenco.slice(0, 50)) {
    console.log(`  ${u.createdAt.toISOString().slice(0, 10)}  ${u.email.padEnd(34)} @${u.username}`);
  }
  if (elenco.length > 50) console.log(`  … e altri ${elenco.length - 50}`);

  if (dryRun) {
    console.log('\n--dry-run: nessuna modifica scritta.\n');
    return;
  }

  const ora = new Date();
  const esito = await User.updateMany(filtro, {
    $set: {
      emailVerifiedAt: ora,
      // La scadenza dell'account non verificato va tolta INSIEME alla conferma:
      // lasciarla farebbe cancellare dall'indice TTL account appena sanati.
      unverifiedExpiresAt: null,
      emailVerificationCodeHash: null,
      emailVerificationExpiresAt: null
    }
  });

  console.log(`\n${esito.modifiedCount} account confermati d'ufficio il ${ora.toISOString()}.`);
  console.log('Annota data e motivo in DEPLOY.md: e\' una decisione, non una migrazione.\n');
}

main()
  .catch((err) => { console.error(`\nErrore: ${err.message}\n`); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
