/**
 * Returns true if `date` is on a different UTC calendar day than now
 * (or is missing) — used to roll over daily usage counters.
 */
function isNewUTCDay(date) {
  if (!date) return true;
  const d = new Date(date);
  const n = new Date();
  return (
    d.getUTCFullYear() !== n.getUTCFullYear() ||
    d.getUTCMonth() !== n.getUTCMonth() ||
    d.getUTCDate() !== n.getUTCDate()
  );
}

/**
 * Resets a subscription user's daily message/image counters once per UTC day.
 * No-op for free users (they are gated by credits, not daily limits).
 * Persists the change so the "range limit rinnovato ogni 24h" actually works.
 */
async function applyDailyReset(user) {
  if (!user || user.subscription === 'free') return;
  if (!isNewUTCDay(user.lastResetDate)) return;
  user.dailyMessageCount = 0;
  user.dailyImageCount = 0;
  user.lastResetDate = new Date();
  await user.save();
}

/**
 * Reverts an expired subscription back to 'free' so daily limits / access
 * reflect reality once the paid period ends.
 */
async function applySubscriptionExpiry(user) {
  if (!user || user.subscription === 'free') return;
  if (user.subscriptionExpiresAt && new Date(user.subscriptionExpiresAt) < new Date()) {
    user.subscription = 'free';
    user.subscriptionExpiresAt = null;
    user.subscriptionCancelAtPeriodEnd = false;
    await user.save();
  }
}

/**
 * Riattiva un account la cui sospensione a termine e' scaduta.
 *
 * `banExpiresAt` veniva scritto quando un amministratore sospendeva un account,
 * e mostrato all'utente nel messaggio di blocco — ma non veniva letto da
 * nessuna parte. Una sospensione di sette giorni era quindi perpetua, e la data
 * comunicata all'utente una promessa che non si avverava. Nessun test se ne era
 * accorto perche' nessuno arrivava mai all'ottavo giorno.
 *
 * Lo stesso schema era gia' risolto correttamente per gli abbonamenti in
 * `applySubscriptionExpiry`, poche righe piu' sopra: qui non era stato replicato.
 *
 * @returns {Promise<boolean>} true se la sospensione e' stata revocata adesso
 */
async function applyBanExpiry(user) {
  if (!user || !user.isBanned) return false;
  // Una sospensione senza data e' permanente per definizione: non scade.
  if (!user.banExpiresAt) return false;
  if (new Date(user.banExpiresAt) > new Date()) return false;

  user.isBanned = false;
  user.banReason = null;
  user.banExpiresAt = null;
  await user.save();
  return true;
}

module.exports = { isNewUTCDay, applyDailyReset, applySubscriptionExpiry, applyBanExpiry };
