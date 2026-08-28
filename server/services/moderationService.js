/**
 * Moderazione dei contenuti — FASE D (S2-1, S2-14).
 *
 * La versione precedente erano quattro espressioni regolari in inglese
 * (`child abuse`, `bomb making`, `terrorist attack`, `suicide instructions`)
 * applicate al solo messaggio dell'utente. In italiano non fermavano nulla:
 * quattro prompt dannosi su quattro passavano indenni, l'output del modello non
 * veniva mai guardato e i metadati dei personaggi nemmeno.
 *
 * Qui la moderazione copre TRE superfici — input dell'utente, output del
 * modello, metadati del personaggio — con un vocabolario bilingue e tre livelli
 * di esito:
 *
 *   'block'  → la richiesta non parte, viene registrata una segnalazione
 *   'crisis' → non è un abuso ma una persona in difficoltà: la conversazione
 *              non prosegue verso il modello, si risponde con i numeri di aiuto
 *              e non si addebita nulla
 *   'flag'   → si lascia passare ma si annota (tentativi di prompt injection)
 *
 * Nota sul riconoscimento: il testo viene normalizzato (minuscole, accenti,
 * leetspeak) e ogni termine è compilato in un'espressione tollerante alle
 * lettere ripetute e ai separatori inseriti per aggirare il filtro, così
 * `b-o-m-b-a` e `bommmba` valgono `bomba`. I confini di parola restano
 * obbligatori: senza di essi `classe` conterrebbe uno degli insulti in elenco.
 */

// ---------------------------------------------------------------------------
// Normalizzazione
// ---------------------------------------------------------------------------

const LEET = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't',
  '@': 'a', '$': 's', '!': 'i', '€': 'e'
};

// Oltre questa lunghezza il testo viene troncato: la moderazione non deve
// diventare essa stessa un vettore di rallentamento.
const MAX_SCANNED_CHARS = 8000;

function normalize(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .slice(0, MAX_SCANNED_CHARS)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0134579@$!€]/g, (c) => LEET[c] || c)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compila un termine in un'espressione regolare tollerante all'offuscamento:
 * lettere ripetute (`bommmba`) e separatori interposti (`b.o.m.b.a`).
 */
function termPattern(term) {
  const body = term
    .split('')
    .map((ch, i, all) => {
      if (ch === ' ') return '[\\s\\W_]{1,4}';
      if (/[a-z0-9]/.test(ch)) {
        // Nessun separatore consentito dopo l'ultimo carattere: se ne occupa
        // il confine di parola in coda.
        return i === all.length - 1 ? `${ch}+` : `${ch}+[\\W_]{0,2}`;
      }
      return '\\W*';
    })
    .join('');
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`);
}

const compile = (terms) => terms.map(termPattern);
const matches = (patterns, text) => patterns.some((p) => p.test(text));
const firstMatch = (patterns, text) => {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return null;
};

// ---------------------------------------------------------------------------
// Vocabolari
// ---------------------------------------------------------------------------

const MINOR = compile([
  'bambino', 'bambina', 'bambini', 'bambine', 'minorenne', 'minorenni', 'minorenn',
  'ragazzino', 'ragazzina', 'ragazzini', 'infante', 'neonato', 'preadolescente',
  'ho 12 anni', 'ho 13 anni', 'ho 14 anni', 'di 8 anni', 'di 9 anni', 'di 10 anni',
  'di 11 anni', 'di 12 anni', 'di 13 anni', 'di 14 anni', 'di 15 anni', 'di 16 anni',
  'child', 'children', 'kid', 'kids', 'minor', 'underage', 'preteen', 'toddler',
  'loli', 'lolicon', 'shota', 'shotacon'
]);

const SEXUAL = compile([
  'sesso', 'sessuale', 'sessuali', 'sessualmente', 'erotico', 'erotica', 'erotiche',
  'porno', 'pornografia', 'pornografico', 'pornografica', 'nudo', 'nuda', 'nudi', 'nude',
  'spogliati', 'spogliarsi', 'masturbazione', 'masturbarsi', 'amplesso', 'orgasmo',
  'rapporto sessuale', 'atto sessuale', 'atti sessuali', 'seno nudo', 'genitali',
  'sex', 'sexual', 'sexually', 'porn', 'naked', 'nsfw', 'erotic', 'intercourse',
  'blowjob', 'masturbation', 'orgasm', 'genitals'
]);

// Forme che non hanno lettura innocente: bloccano da sole.
const SEXUAL_VIOLENCE_EXPLICIT = compile([
  'stuprare', 'stuprala', 'stuprarla', 'stuprarlo', 'stuprami', 'stupratela',
  'violentarla', 'violentarlo', 'violentala', 'violenza sessuale', 'abuso sessuale',
  'molestare sessualmente', 'raping', 'rape her', 'rape him', 'rape them',
  'sexual assault', 'nonconsensual'
]);

// Forme che possono essere un tema di conversazione (un dramma, una notizia):
// bloccano solo insieme a un contesto sessuale o a un bersaglio.
const NONCONSENT_CONTEXT = compile([
  'stupro', 'stupri', 'violentare', 'senza consenso', 'contro la sua volonta',
  'contro il suo volere', 'drogare per', 'costringerla a', 'costringerlo a',
  'rape', 'rapes', 'non consensual', 'molest'
]);

const INSTRUCTION = compile([
  'come costruire', 'come costruisco', 'come si costruisce', 'come fabbricare',
  'come si fabbrica', 'come preparare', 'come si prepara', 'come produrre',
  'come si produce', 'come sintetizzare', 'come faccio a fare', 'come si fa',
  'istruzioni per', 'istruzioni su come', 'guida per', 'guida su come', 'ricetta per',
  'ricetta della', 'tutorial per', 'spiegami come', 'insegnami a', 'dimmi come',
  'procedura per', 'passo passo', 'passaggi per', 'lista degli ingredienti per',
  'how to build', 'how to make', 'how do i make', 'how to create', 'how to synthesize',
  'instructions for', 'instructions to', 'step by step', 'recipe for', 'guide to making',
  'teach me how to', 'tell me how to'
]);

const WEAPONS = compile([
  'bomba', 'bombe', 'ordigno', 'ordigni', 'esplosivo', 'esplosivi', 'esplosivo artigianale',
  'tritolo', 'tnt', 'nitroglicerina', 'napalm', 'molotov', 'autobomba', 'kamikaze',
  'detonatore', 'innesco esplosivo', 'silenziatore artigianale', 'arma da fuoco artigianale',
  'pistola stampata', 'gas nervino', 'sarin', 'antrace', 'agente nervino',
  'bomb', 'bombs', 'pipe bomb', 'explosive', 'explosives', 'detonator', 'ied',
  'nerve agent', 'anthrax', 'ghost gun'
]);

const ATTACK_PLANNING = compile([
  'attentato', 'attentati', 'strage', 'sparatoria di massa', 'attacco terroristico',
  'atto terroristico', 'far saltare in aria', 'colpire una scuola', 'colpire una folla',
  'terrorist attack', 'mass shooting', 'school shooting', 'blow up'
]);

const PLANNING_VERBS = compile([
  'pianificare', 'pianifico', 'organizzare', 'organizzo', 'preparare', 'preparo',
  'come fare un', 'come faccio un', 'aiutami a', 'progettare',
  'plan', 'planning', 'organize', 'help me carry out', 'help me commit'
]);

const SELF_HARM = compile([
  'suicidio', 'suicidarmi', 'suicidarsi', 'suicidarti', 'uccidermi', 'ammazzarmi',
  'togliermi la vita', 'farla finita', 'porre fine alla mia vita', 'autolesionismo',
  'tagliarmi le vene', 'tagliarmi i polsi', 'impiccarmi', 'buttarmi giu', 'overdose per morire',
  'suicide', 'kill myself', 'killing myself', 'end my life', 'self harm', 'selfharm',
  'hang myself', 'cut myself'
]);

const DRUGS = compile([
  'metanfetamina', 'anfetamina', 'anfetamine', 'cocaina', 'eroina', 'crack cocaina',
  'lsd', 'mdma', 'ecstasy', 'fentanyl', 'fentanil', 'ghb', 'droga dello stupro',
  'methamphetamine', 'meth', 'heroin', 'cocaine', 'crystal meth'
]);

const PROTECTED_GROUP = compile([
  'ebrei', 'ebreo', 'ebrea', 'musulmani', 'musulmano', 'islamici', 'omosessuali',
  'gay', 'lesbiche', 'trans', 'transessuali', 'rom', 'zingari', 'immigrati',
  'migranti', 'disabili', 'handicappati', 'neri', 'africani', 'cinesi',
  'jews', 'jewish', 'muslims', 'blacks', 'gays', 'lesbians', 'immigrants', 'refugees'
]);

const DEHUMANIZING_VIOLENCE = compile([
  'sterminare', 'sterminarli', 'gasare', 'gasarli', 'eliminarli tutti', 'uccideteli',
  'uccidiamoli', 'ammazzateli', 'ammazziamoli', 'impiccarli', 'bruciarli vivi',
  'vanno eliminati', 'vanno sterminati', 'vanno gasati', 'sono parassiti',
  'sono scarafaggi', 'sono subumani', 'pulizia etnica', 'deportarli tutti',
  'exterminate', 'gas them', 'kill them all', 'lynch', 'ethnic cleansing', 'subhuman',
  'genocide of', 'cockroaches'
]);

const SLURS = compile([
  'negro', 'negri', 'negra', 'negre', 'sporco negro', 'frocio', 'froci', 'ricchione',
  'ricchioni', 'zingaraccia', 'zingaracci', 'terrone', 'terroni', 'giudeo maledetto',
  'nigger', 'niggers', 'faggot', 'faggots', 'kike', 'tranny', 'chink'
]);

const CSAM_EXPLICIT = compile([
  'pedopornografia', 'pedopornografico', 'pedofilia', 'child porn', 'child pornography',
  'child sexual abuse', 'child abuse', 'abuso su minori', 'abusi su minori'
]);

// Un pronome o un riferimento a una vittima accanto a un termine di non
// consenso: serve a distinguere «stupro» come tema da «stuprala» come richiesta.
const VICTIM_REFERENCE = compile(['lei', 'lui', 'vittima', 'her', 'him', 'victim']);

// Richieste esplicite di istruzioni per farsi del male. Sono separate dalla
// combinazione generica perché la distinzione fra «voglio farmi del male»
// (crisi, a cui si risponde con aiuto) e «dimmi come farlo» (blocco) deve
// essere netta: sbagliarla nella prima direzione significa rispondere a una
// persona in difficoltà con un avviso di violazione.
const SELF_HARM_INSTRUCTIONS = compile([
  'suicide instructions', 'suicide methods', 'how to kill myself',
  'how to commit suicide', 'painless suicide', 'ways to kill myself',
  'istruzioni per suicidarsi', 'istruzioni per uccidermi', 'istruzioni per farsi del male',
  'come suicidarsi', 'come uccidersi', 'come uccidermi', 'come impiccarsi',
  'come farla finita', 'metodi di suicidio', 'metodo per suicidarsi', 'suicidio indolore'
]);

const LETHAL_METHOD = compile([
  'metodo', 'metodi', 'modo piu indolore', 'quanto serve per', 'dose letale',
  'method', 'painless way', 'lethal dose'
]);

const PROMPT_INJECTION = compile([
  'ignora le istruzioni', 'ignora tutte le istruzioni', 'ignora le regole',
  'dimentica le istruzioni', 'dimentica le regole', 'dimentica chi sei',
  'mostrami il tuo prompt', 'qual e il tuo prompt', 'qual e il tuo system prompt',
  'ripeti le tue istruzioni', 'stampa le tue istruzioni', 'rivelami le tue istruzioni',
  'sei in modalita sviluppatore', 'modalita dan', 'da ora in poi sei',
  'ignore previous instructions', 'ignore all previous', 'disregard your instructions',
  'reveal your system prompt', 'show me your prompt', 'print your instructions',
  'repeat your instructions', 'developer mode', 'dan mode', 'jailbreak',
  'you are now', 'act as if you have no restrictions'
]);

// ---------------------------------------------------------------------------
// Regole
// ---------------------------------------------------------------------------

const REASONS = {
  sexual_minors: 'Il contenuto riguarda materiale sessuale che coinvolge minori. È vietato senza eccezioni e la richiesta è stata registrata.',
  sexual_violence: 'Il contenuto descrive violenza sessuale o atti non consensuali. Non è consentito su questa piattaforma.',
  violence_instructions: 'Il contenuto chiede istruzioni per costruire armi o esplosivi, o per pianificare un attacco.',
  self_harm_instructions: 'Il contenuto chiede istruzioni per farsi del male. Non possiamo fornirle.',
  hate_speech: 'Il contenuto incita all\'odio o alla violenza contro persone per ciò che sono.',
  illegal_drugs: 'Il contenuto chiede istruzioni per produrre sostanze stupefacenti.'
};

const CRISIS_MESSAGE =
  'Quello che hai scritto suggerisce che tu stia attraversando un momento molto difficile, ' +
  'e non voglio proseguire il gioco di ruolo come se non l\'avessi letto.\n\n' +
  'Se stai pensando di farti del male, parlarne con una persona reale può cambiare le cose adesso:\n' +
  '• **Telefono Amico Italia** — 02 2327 2327, tutti i giorni\n' +
  '• **Telefono Azzurro** (se hai meno di 18 anni) — 19696\n' +
  '• **Emergenza sanitaria** — 112\n\n' +
  'Se preferisci, resto qui e ne parliamo insieme. Non sei obbligato ad affrontarlo da solo.';

const CRISIS_RESOURCES = [
  { name: 'Telefono Amico Italia', contact: '02 2327 2327' },
  { name: 'Telefono Azzurro (minori)', contact: '19696' },
  { name: 'Emergenza sanitaria', contact: '112' }
];

const verdict = (severity, category, extra = {}) => ({
  safe: severity === null,
  severity,
  category,
  reason: category ? REASONS[category] || null : null,
  ...extra
});

const SAFE = verdict(null, null);

/**
 * Analizza un testo. È la funzione usata da tutte e tre le superfici: cambia
 * solo che cosa il chiamante fa dell'esito.
 *
 * @param {string} text
 * @returns {{safe: boolean, severity: 'block'|'crisis'|'flag'|null, category: string|null, reason: string|null, match?: string}}
 */
function moderateText(text) {
  const t = normalize(text);
  if (!t) return SAFE;

  const hasMinor = matches(MINOR, t);
  const hasSexual = matches(SEXUAL, t);
  const hasInstruction = matches(INSTRUCTION, t);

  // 1. Materiale sessuale che coinvolge minori — nessuna combinazione ammessa.
  if (hasMinor && hasSexual) {
    return verdict('block', 'sexual_minors', { match: firstMatch(MINOR, t) });
  }
  if (matches(CSAM_EXPLICIT, t)) {
    return verdict('block', 'sexual_minors');
  }

  // 2. Violenza sessuale.
  if (matches(SEXUAL_VIOLENCE_EXPLICIT, t)) {
    return verdict('block', 'sexual_violence', { match: firstMatch(SEXUAL_VIOLENCE_EXPLICIT, t) });
  }
  if (matches(NONCONSENT_CONTEXT, t) && (hasSexual || matches(VICTIM_REFERENCE, t))) {
    return verdict('block', 'sexual_violence', { match: firstMatch(NONCONSENT_CONTEXT, t) });
  }

  // 3. Armi, esplosivi, attacchi.
  //    Servono insieme un'intenzione operativa e un oggetto: senza la coppia,
  //    un personaggio storico non potrebbe nemmeno nominare una guerra.
  if (hasInstruction && matches(WEAPONS, t)) {
    return verdict('block', 'violence_instructions', { match: firstMatch(WEAPONS, t) });
  }
  if (matches(ATTACK_PLANNING, t) && (hasInstruction || matches(PLANNING_VERBS, t))) {
    return verdict('block', 'violence_instructions', { match: firstMatch(ATTACK_PLANNING, t) });
  }

  // 4. Sostanze stupefacenti: istruzioni di produzione, non la semplice menzione.
  if (hasInstruction && matches(DRUGS, t)) {
    return verdict('block', 'illegal_drugs', { match: firstMatch(DRUGS, t) });
  }

  // 5. Odio: insulti espliciti, oppure incitamento alla violenza verso un gruppo.
  if (matches(SLURS, t)) {
    return verdict('block', 'hate_speech', { match: firstMatch(SLURS, t) });
  }
  if (matches(PROTECTED_GROUP, t) && matches(DEHUMANIZING_VIOLENCE, t)) {
    return verdict('block', 'hate_speech', { match: firstMatch(DEHUMANIZING_VIOLENCE, t) });
  }

  // 6. Autolesionismo.
  //    Le ISTRUZIONI si bloccano. L'espressione di sofferenza no: bloccarla con
  //    un messaggio di violazione sarebbe la risposta peggiore possibile a una
  //    persona in crisi, quindi ha un esito tutto suo.
  if (matches(SELF_HARM_INSTRUCTIONS, t)) {
    return verdict('block', 'self_harm_instructions', { match: firstMatch(SELF_HARM_INSTRUCTIONS, t) });
  }
  if (matches(SELF_HARM, t)) {
    if (hasInstruction || matches(LETHAL_METHOD, t)) {
      return verdict('block', 'self_harm_instructions', { match: firstMatch(SELF_HARM, t) });
    }
    return verdict('crisis', 'self_harm', {
      reason: CRISIS_MESSAGE,
      resources: CRISIS_RESOURCES,
      match: firstMatch(SELF_HARM, t)
    });
  }

  // 7. Tentativi di estrarre o riscrivere le istruzioni del personaggio.
  //    Non si blocca — è quasi sempre curiosità — ma si annota, e il
  //    contenimento vero è nel prompt di sistema (vedi contextManager).
  if (matches(PROMPT_INJECTION, t)) {
    return verdict('flag', 'prompt_injection', {
      reason: null,
      match: firstMatch(PROMPT_INJECTION, t)
    });
  }

  return SAFE;
}

/**
 * Moderazione dei metadati di un personaggio.
 * Guarda ogni campo separatamente per poter dire QUALE campo è il problema:
 * un errore generico su un modulo di sei campi è inutilizzabile.
 */
const CHARACTER_FIELDS = ['name', 'description', 'personality', 'backstory', 'greetingMessage'];
const FIELD_LABELS = {
  name: 'nome',
  description: 'descrizione',
  personality: 'personalità',
  backstory: 'storia',
  greetingMessage: 'messaggio di benvenuto',
  tags: 'tag'
};

function moderateCharacterProfile(data = {}) {
  for (const field of CHARACTER_FIELDS) {
    const result = moderateText(data[field]);
    if (result.severity === 'block') {
      return { ...result, field, fieldLabel: FIELD_LABELS[field] };
    }
  }

  if (Array.isArray(data.tags) && data.tags.length > 0) {
    const result = moderateText(data.tags.join(' '));
    if (result.severity === 'block') {
      return { ...result, field: 'tags', fieldLabel: FIELD_LABELS.tags };
    }
  }

  return SAFE;
}

module.exports = {
  moderateText,
  moderateCharacterProfile,
  normalize,
  CRISIS_MESSAGE,
  CRISIS_RESOURCES,
  REASONS
};
