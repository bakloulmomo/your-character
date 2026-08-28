/**
 * Contatori operativi e allarmi (FASE E — punto 5).
 *
 * Due domande a cui finora non era possibile rispondere:
 *   · quanto stiamo spendendo oggi in chiamate al modello?
 *   · quante di quelle chiamate stanno fallendo?
 *
 * La prima ha una risposta autorevole nel database (`Message.cost` è scritto a
 * ogni risposta) e viene calcolata lì. La seconda no: un errore non produce un
 * messaggio, quindi non lascia traccia in nessuna collezione — per quella
 * servono contatori in memoria.
 *
 * Conseguenza dichiarata: i contatori si azzerano a ogni riavvio del processo e
 * non sono condivisi fra più istanze. Vanno bene per accorgersi che qualcosa si
 * sta rompendo *adesso*; non sono contabilità. Il giorno in cui servisse un dato
 * consolidato, la fonte è il database.
 */
const logger = require('./logger');

const COST_ALERT_EUR = Number(process.env.DAILY_COST_ALERT_EUR || 25);
const ERROR_RATE_ALERT = Number(process.env.LLM_ERROR_RATE_ALERT || 0.2);
// Sotto questa soglia il tasso d'errore non significa niente: 1 fallimento su 2
// chiamate è il 50%, ma non è un'anomalia — è un campione troppo piccolo.
const MIN_SAMPLE = Number(process.env.LLM_ERROR_RATE_MIN_SAMPLE || 20);

const today = () => new Date().toISOString().slice(0, 10);

const emptyDay = (day) => ({
  day,
  llm: { calls: 0, errors: 0, costEur: 0 },
  image: { calls: 0, errors: 0, costEur: 0 },
  moderation: { blocked: 0, crisis: 0, flagged: 0, outputBlocked: 0 },
  // Un allarme che si ripete a ogni chiamata smette di essere un allarme:
  // si emette una volta per giornata e per tipo.
  alerted: { cost: false, llmErrorRate: false, imageErrorRate: false }
});

let state = emptyDay(today());

/** Il giorno cambia: si riparte da zero, senza conservare lo storico in memoria. */
function rollIfNeeded() {
  const day = today();
  if (state.day !== day) state = emptyDay(day);
  return state;
}

function alertCostIfNeeded(s) {
  const total = s.llm.costEur + s.image.costEur;
  if (s.alerted.cost || total < COST_ALERT_EUR) return;
  s.alerted.cost = true;
  logger.error(
    { alert: 'daily_cost', day: s.day, costEur: Number(total.toFixed(4)), thresholdEur: COST_ALERT_EUR },
    `Spesa giornaliera oltre la soglia: ${total.toFixed(2)} € (soglia ${COST_ALERT_EUR} €)`
  );
}

function alertErrorRateIfNeeded(s, kind) {
  const bucket = s[kind];
  const alertKey = kind === 'llm' ? 'llmErrorRate' : 'imageErrorRate';
  if (s.alerted[alertKey] || bucket.calls < MIN_SAMPLE) return;

  const rate = bucket.errors / bucket.calls;
  if (rate < ERROR_RATE_ALERT) return;

  s.alerted[alertKey] = true;
  logger.error(
    { alert: `${kind}_error_rate`, day: s.day, rate: Number(rate.toFixed(3)), calls: bucket.calls, errors: bucket.errors, threshold: ERROR_RATE_ALERT },
    `Tasso di errore ${kind} al ${(rate * 100).toFixed(0)}% su ${bucket.calls} chiamate (soglia ${(ERROR_RATE_ALERT * 100).toFixed(0)}%)`
  );
}

/**
 * @param {'llm'|'image'} kind
 * @param {{ok: boolean, costEur?: number}} outcome
 */
function recordCall(kind, { ok, costEur = 0 }) {
  const s = rollIfNeeded();
  const bucket = s[kind];
  if (!bucket) return;

  bucket.calls += 1;
  if (!ok) bucket.errors += 1;
  bucket.costEur += Number(costEur) || 0;

  alertCostIfNeeded(s);
  alertErrorRateIfNeeded(s, kind);
}

/** @param {'blocked'|'crisis'|'flagged'|'outputBlocked'} kind */
function recordModeration(kind) {
  const s = rollIfNeeded();
  if (typeof s.moderation[kind] === 'number') s.moderation[kind] += 1;
}

function snapshot() {
  const s = rollIfNeeded();
  const rate = (b) => (b.calls > 0 ? Number((b.errors / b.calls).toFixed(3)) : 0);

  return {
    day: s.day,
    llm: { ...s.llm, costEur: Number(s.llm.costEur.toFixed(4)), errorRate: rate(s.llm) },
    image: { ...s.image, costEur: Number(s.image.costEur.toFixed(4)), errorRate: rate(s.image) },
    moderation: { ...s.moderation },
    thresholds: { costEur: COST_ALERT_EUR, errorRate: ERROR_RATE_ALERT, minSample: MIN_SAMPLE },
    alerted: { ...s.alerted },
    // Detto apertamente, perché chi legge questi numeri deve sapere che cosa
    // sta guardando: sono di questo processo, da quando è partito.
    scope: 'processo singolo, azzerato a ogni riavvio'
  };
}

/** Solo per i test: riporta i contatori allo stato iniziale. */
function resetMetrics() {
  state = emptyDay(today());
}

module.exports = { recordCall, recordModeration, snapshot, resetMetrics };
