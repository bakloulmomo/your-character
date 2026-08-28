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

module.exports = { isNewUTCDay, applyDailyReset, applySubscriptionExpiry };
