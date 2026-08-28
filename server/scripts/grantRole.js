#!/usr/bin/env node
/**
 * Assegna un ruolo a un account esistente (FASE D — S2-13).
 *
 *   node scripts/grantRole.js utente@example.com moderator
 *   node scripts/grantRole.js utente@example.com user      # revoca
 *
 * Esiste perché la coda di revisione è protetta da un ruolo, e un ruolo deve
 * poter essere concesso e tolto da chi amministra il servizio senza toccare il
 * database a mano. La partenza a freddo (il primissimo amministratore) si
 * risolve invece con la variabile ADMIN_EMAILS.
 */
const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../models/User');

const ROLES = ['user', 'moderator', 'admin'];

async function main() {
  const [email, role] = process.argv.slice(2);

  if (!email || !role) {
    console.error('Uso: node scripts/grantRole.js <email> <user|moderator|admin>');
    process.exit(1);
  }
  if (!ROLES.includes(role)) {
    console.error(`Ruolo non valido: "${role}". Ammessi: ${ROLES.join(', ')}.`);
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/your-character';
  await mongoose.connect(uri);

  const user = await User.findOneAndUpdate(
    { email: email.toLowerCase().trim() },
    { role },
    { new: true }
  ).select('email username role');

  if (!user) {
    console.error(`Nessun account con l'indirizzo ${email}.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`✅ ${user.username} <${user.email}> → ruolo "${user.role}"`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Errore:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
