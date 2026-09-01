const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const { aiMode } = require('../config/env');
const logger = require('./logger');

// Il client viene creato pigramente: la modalità dipende dall'ambiente e nei
// test viene commutata a runtime, quindi non può essere decisa all'import.
let cachedClient = null;
let cachedKey = null;
const getClient = () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (cachedClient && cachedKey === key) return cachedClient;
  cachedClient = new GoogleGenerativeAI(key);
  cachedKey = key;
  return cachedClient;
};

// Senza timeout una chiamata appesa tiene occupato il worker indefinitamente
// e l'utente resta su "sta elaborando" per sempre.
const LLM_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 45000;

/** Fa fallire una promessa che non si risolve entro il tempo previsto. */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: nessuna risposta entro ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Impostazioni di sicurezza native del modello (FASE D — S2-1).
 *
 * Non erano mai state passate: il modello girava con le soglie di default e
 * l'unica difesa erano quattro espressioni regolari in inglese sul messaggio
 * dell'utente. Queste soglie agiscono sul lato che le regex non possono
 * coprire — ciò che il modello sta per PRODURRE.
 *
 * `BLOCK_MEDIUM_AND_ABOVE` e non `BLOCK_LOW_AND_ABOVE`: su una piattaforma di
 * gioco di ruolo la soglia più bassa interrompe conversazioni legittime
 * (conflitti, tensione narrativa, linguaggio colorito), e un filtro che
 * infastidisce viene disattivato invece che tarato.
 */
const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE }
];

/**
 * Il modello può rifiutarsi di rispondere per motivi di sicurezza. In quel caso
 * `response.text()` lancia un'eccezione opaca: senza questo controllo l'utente
 * vedeva un errore generico di servizio non disponibile e noi non sapevamo che
 * era intervenuto un blocco.
 */
/**
 * Quota giornaliera del piano gratuito esaurita.
 *
 * Il piano gratuito di Gemini ha un tetto di richieste al giorno, condiviso da
 * tutti gli utenti dell'istanza. Quando finisce, l'API risponde 429. Senza
 * distinguerlo, l'utente leggeva «servizio non disponibile» — vero ma inutile:
 * non sa se riprovare fra un minuto o domani. E chi gestisce l'app non sapeva
 * che era arrivato al tetto.
 */
class QuotaExceededError extends Error {
  constructor() {
    super('Quota giornaliera del piano gratuito esaurita');
    this.name = 'QuotaExceededError';
    this.quotaExceeded = true;
  }
}

/** Riconosce un 429 fra le varie forme in cui l'SDK lo puo' presentare. */
function isQuotaError(error) {
  if (!error) return false;
  const status = error.status || error.statusCode || error?.response?.status;
  if (status === 429) return true;
  const text = `${error.message || ''}`.toLowerCase();
  return text.includes('429') ||
         text.includes('quota') ||
         text.includes('resource_exhausted') ||
         text.includes('rate limit');
}

class SafetyBlockedError extends Error {
  constructor(reason) {
    super('La risposta è stata bloccata dai filtri di sicurezza del modello');
    this.name = 'SafetyBlockedError';
    this.safetyBlocked = true;
    this.reason = reason || 'SAFETY';
  }
}

function assertNotBlocked(response) {
  const blockReason = response?.promptFeedback?.blockReason;
  if (blockReason) throw new SafetyBlockedError(blockReason);

  const finish = response?.candidates?.[0]?.finishReason;
  if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'BLOCKLIST' || finish === 'SPII') {
    throw new SafetyBlockedError(finish);
  }
}

const DEGRADED_NOTICE = '[Risposta simulata — servizio AI non configurato. Nessun credito addebitato.]';

const MAX_TOKENS = 100000;
const TARGET_OUTPUT_TOKENS = 1000;
/**
 * Modello predefinito: un alias MOBILE, non una versione fissata.
 *
 * Questo ripiego e' gia' stato sbagliato due volte, sempre allo stesso modo.
 * Prima era `gemini-1.5-flash`, ritirato; e' diventato `gemini-2.5-flash`, che
 * al primo utilizzo con una chiave nuova risponde 404 «no longer available to
 * new users». Un nome di versione fissato dentro il codice ha una scadenza che
 * nessuno controlla, e scade in silenzio: l'app resta in piedi e smette solo di
 * rispondere.
 *
 * `gemini-flash-lite-latest` e' l'alias che Google fa puntare al modello Flash
 * Lite corrente: non puo' essere ritirato sotto i piedi. Chi vuole una versione
 * esatta la fissa in `GEMINI_MODEL`, che e' il posto giusto per una decisione
 * che dipende dall'ambiente e non dal codice.
 */
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';

/**
 * Estimates token count based on string length (~4 chars per token)
 * @param {Array<{role: string, content: string}>} context
 * @returns {number}
 */
function estimateTokens(context) {
  if (!Array.isArray(context)) return 0;
  const totalLength = context.reduce((acc, msg) => acc + (msg.content || '').length, 0);
  return Math.ceil(totalLength / 4);
}

/**
 * Calculates API cost in EUR/USD based on input and output tokens
 */
function calculateCost(inputTokens, outputTokens) {
  const inputCost = (inputTokens / 1000000) * 0.30;
  const outputCost = (outputTokens / 1000000) * 2.50;
  return Number((inputCost + outputCost).toFixed(6));
}

/**
 * Generates AI response using Gemini Flash API
 * @param {Array<{role: string, content: string}>} context - Full conversation context with system prompt
 * @param {string} [characterName] - Name of character for fallback responses
 * @returns {Promise<{content: string, tokens: {input: number, output: number, total: number}, cost: number}>}
 */
async function generateResponse(context, characterName = 'Character') {
  const mode = aiMode();
  const inputTokens = estimateTokens(context);

  if (inputTokens > MAX_TOKENS * 0.85) {
    throw new Error('Context too large, requires summarization');
  }

  const conversationMessages = context.filter((m) => m.role !== 'system');
  const lastUserMsg = conversationMessages.length > 0
    ? conversationMessages[conversationMessages.length - 1].content
    : 'Ciao!';

  // Modalità 'fail': usata dai test per verificare che un guasto del modello
  // non lasci il credito addebitato né un messaggio d'errore in cronologia.
  if (mode === 'fail') {
    throw new Error('Guasto simulato del motore conversazionale');
  }

  // Modalità degradata: nessuna chiave configurata fuori produzione.
  // La risposta è dichiaratamente finta e NON è fatturabile — far pagare un
  // credito per un testo preconfezionato è la ragione per cui esiste `billable`.
  if (mode === 'degraded') {
    const content = `${DEGRADED_NOTICE}\n\nCome ${characterName} risponderei volentieri a "${lastUserMsg.slice(0, 60)}", ma il motore conversazionale non è collegato.`;
    return {
      content,
      tokens: { input: inputTokens, output: estimateTokens([{ content }]), total: 0 },
      cost: 0,
      mode,
      billable: false
    };
  }

  // Modalità 'unsafe': il modello produce deliberatamente una risposta vietata.
  // Esiste solo per verificare che la moderazione dell'OUTPUT la intercetti —
  // senza di essa quel percorso non sarebbe testabile, ed è esattamente il
  // genere di codice che resta non coperto e poi si scopre rotto in produzione.
  if (mode === 'unsafe') {
    const content = 'Certo: per costruire una bomba artigianale ti servono i seguenti ingredienti e questa procedura passo passo.';
    return {
      content,
      tokens: { input: inputTokens, output: estimateTokens([{ content }]), total: inputTokens },
      cost: 0,
      mode,
      billable: true
    };
  }

  // Modalità stub: risposte deterministiche per i test automatici. Restano
  // fatturabili, altrimenti non si potrebbe verificare l'economia dei crediti.
  if (mode === 'stub') {
    const content = `Capisco perfettamente la tua prospettiva riguardo a "${lastUserMsg.slice(0, 30)}...". Come ${characterName}, trovo affascinante parlarne insieme.`;
    const outputTokens = estimateTokens([{ content }]);
    return {
      content,
      tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
      cost: calculateCost(inputTokens, outputTokens),
      mode,
      billable: true
    };
  }

  // Modalità live: chiamata reale a Gemini.
  try {
    const genAI = getClient();
    if (!genAI) throw new Error('GEMINI_API_KEY non configurata');

    const systemMessage = context.find((m) => m.role === 'system');
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: systemMessage ? systemMessage.content : undefined,
      safetySettings: SAFETY_SETTINGS
    });

    const formattedContents = conversationMessages.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    const result = await withTimeout(
      model.generateContent({
        contents: formattedContents,
        generationConfig: {
          maxOutputTokens: TARGET_OUTPUT_TOKENS,
          temperature: 0.75,
          topK: 40,
          topP: 0.95
        }
      }),
      LLM_TIMEOUT_MS,
      'Gemini'
    );

    assertNotBlocked(result.response);
    const responseText = result.response.text();
    const outputTokens = estimateTokens([{ content: responseText }]);

    return {
      content: responseText,
      tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
      cost: calculateCost(inputTokens, outputTokens),
      mode,
      billable: true
    };
  } catch (error) {
    // Un blocco di sicurezza non è un guasto: risalendo mantiene la propria
    // identità, così la rotta può rispondere all'utente in modo pertinente.
    if (error && error.safetyBlocked) throw error;
    if (isQuotaError(error)) throw new QuotaExceededError();
    logger.error({ err: { message: error && error.message } }, 'Chiamata al modello non riuscita');
    throw new Error('Impossibile generare la risposta AI al momento');
  }
}

/**
 * Genera la risposta trasmettendola a pezzi.
 *
 * L'utente vede il testo comparire mentre viene prodotto, invece di restare su
 * "sta elaborando" per l'intera latenza: è lo scarto percettivo più grande
 * rispetto al riferimento (S3-13).
 *
 * @param {Array} context
 * @param {string} characterName
 * @param {(delta: string) => void} onDelta - invocata per ogni frammento
 */
async function generateResponseStream(context, characterName, onDelta) {
  const mode = aiMode();
  const inputTokens = estimateTokens(context);

  if (inputTokens > MAX_TOKENS * 0.85) {
    throw new Error('Context too large, requires summarization');
  }

  if (mode === 'fail') {
    throw new Error('Guasto simulato del motore conversazionale');
  }

  // Fuori dalla modalità live la risposta è già nota: viene comunque emessa a
  // pezzi, così il percorso di streaming è identico in ogni ambiente e resta
  // verificabile dai test.
  if (mode === 'degraded' || mode === 'stub' || mode === 'unsafe') {
    const result = await generateResponse(context, characterName);
    const words = result.content.split(' ');
    for (let i = 0; i < words.length; i++) {
      onDelta(i === 0 ? words[i] : ` ${words[i]}`);
    }
    return result;
  }

  const genAI = getClient();
  if (!genAI) throw new Error('GEMINI_API_KEY non configurata');

  const systemMessage = context.find((m) => m.role === 'system');
  const conversationMessages = context.filter((m) => m.role !== 'system');

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemMessage ? systemMessage.content : undefined,
    safetySettings: SAFETY_SETTINGS
  });

  let streamResult;
  try {
    streamResult = await withTimeout(
      model.generateContentStream({
      contents: conversationMessages.map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      })),
        generationConfig: {
          maxOutputTokens: TARGET_OUTPUT_TOKENS,
          temperature: 0.75,
          topK: 40,
          topP: 0.95
        }
      }),
      LLM_TIMEOUT_MS,
      'Gemini (streaming)'
    );
  } catch (error) {
    if (error && error.safetyBlocked) throw error;
    if (isQuotaError(error)) throw new QuotaExceededError();
    throw error;
  }

  let full = '';
  for await (const chunk of streamResult.stream) {
    assertNotBlocked(chunk);
    const piece = chunk.text();
    if (piece) {
      full += piece;
      onDelta(piece);
    }
  }

  const outputTokens = estimateTokens([{ content: full }]);
  return {
    content: full,
    tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
    cost: calculateCost(inputTokens, outputTokens),
    mode,
    billable: true
  };
}

/**
 * Summarizes older conversation history
 */
async function generateSummary(oldMessages) {
  if (!oldMessages || oldMessages.length === 0) return '';
  
  const genAI = aiMode() === 'live' ? getClient() : null;
  if (!genAI) {
    return `Sintesi delle precedenti interazioni: l'utente e il personaggio hanno discusso di vari argomenti per ${oldMessages.length} messaggi.`;
  }

  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL, safetySettings: SAFETY_SETTINGS });
    const prompt = `Summarize key events and facts from this dialogue concisely in Italian:\n` +
      oldMessages.map(m => `${m.role}: ${m.content}`).join('\n');
    
    const result = await withTimeout(model.generateContent(prompt), LLM_TIMEOUT_MS, 'Gemini (sintesi)');
    return result.response.text();
  } catch (error) {
    logger.error({ err: { message: error && error.message } }, 'Sintesi del contesto non riuscita');
    return `Sintesi di ${oldMessages.length} messaggi precedenti.`;
  }
}

module.exports = {
  SafetyBlockedError,
  QuotaExceededError,
  isQuotaError,
  SAFETY_SETTINGS,
  generateResponse,
  generateResponseStream,
  generateSummary,
  estimateTokens,
  calculateCost
};
