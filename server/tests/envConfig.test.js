/**
 * Le guardie d'ambiente stanno dove devono stare — e il percorso caldo resta
 * percorribile.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PERCHÉ QUESTO FILE ESISTE.
 *
 * Un controllo su `DEV_OUTBOX` era finito per copia dentro `jwtSecret()`, dove
 * chiamava `problems.push()` su una variabile che in quello scope non esiste.
 * Con `DEV_OUTBOX=1` — la configurazione che `scripts/e2eStack.js` DEVE usare,
 * perché è l'unico modo per far leggere ai test il codice di conferma, che in
 * database vive solo come impronta — ogni firma di sessione sollevava
 * `ReferenceError`.
 *
 * Il difetto era invisibile da due direzioni insieme. Sul percorso di EMISSIONE
 * dava un 500 sul login. Sul percorso di VERIFICA l'eccezione veniva inghiottita
 * dal `catch` che tratta i token illeggibili come visitatori anonimi: nessun
 * errore nei log, solo ogni richiesta autenticata degradata ad anonima. E
 * nessuna delle 388 prove del server lo incontrava, perché la suite non imposta
 * mai quella variabile: a incontrarlo era solo la suite end-to-end, che da quel
 * momento non è più arrivata oltre la registrazione.
 *
 * I due controlli qui sotto sono le due metà della stessa regola: la validazione
 * dell'ambiente avviene UNA VOLTA all'avvio, e le funzioni che servono ogni
 * richiesta non validano niente.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const { jwtSecret, assertProductionEnv } = require('../config/env');
const { signSession } = require('../services/session');

/** Ripristina l'ambiente esattamente com'era: gli altri file condividono il processo. */
const conAmbiente = (variabili, corpo) => {
  const precedenti = {};
  for (const [chiave, valore] of Object.entries(variabili)) {
    precedenti[chiave] = process.env[chiave];
    if (valore === undefined) delete process.env[chiave];
    else process.env[chiave] = valore;
  }
  try {
    return corpo();
  } finally {
    for (const [chiave, valore] of Object.entries(precedenti)) {
      if (valore === undefined) delete process.env[chiave];
      else process.env[chiave] = valore;
    }
  }
};

const utenteFinto = {
  _id: '650000000000000000000099',
  email: 'prova@example.com',
  username: 'prova',
  tokenVersion: 0
};

describe('La sessione si firma anche con la casella di sviluppo accesa', () => {
  it('jwtSecret() non solleva con DEV_OUTBOX impostata', () => {
    conAmbiente({ DEV_OUTBOX: '1' }, () => {
      expect(() => jwtSecret()).not.toThrow();
      expect(typeof jwtSecret()).toBe('string');
    });
  });

  it('signSession() produce un token con DEV_OUTBOX impostata', () => {
    conAmbiente({ DEV_OUTBOX: '1' }, () => {
      // È la chiamata esatta che `routes/auth.js` fa sul percorso di accesso,
      // e quella che l'ambiente end-to-end attraversa a ogni registrazione.
      const token = signSession(utenteFinto);
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });
  });

  it('il valore restituito è lo stesso con e senza DEV_OUTBOX', () => {
    const senza = conAmbiente({ DEV_OUTBOX: undefined }, () => jwtSecret());
    const con = conAmbiente({ DEV_OUTBOX: '1' }, () => jwtSecret());
    expect(con).toBe(senza);
  });
});

describe('La guardia su DEV_OUTBOX resta dove serve: all\'avvio', () => {
  it('assertProductionEnv() rifiuta DEV_OUTBOX in produzione', () => {
    conAmbiente(
      {
        NODE_ENV: 'production',
        DEV_OUTBOX: '1',
        MONGODB_URI: 'mongodb://esempio/db',
        FRONTEND_URL: 'https://esempio.test',
        JWT_SECRET: 'un_segreto_abbastanza_lungo_per_la_soglia_0000',
        GEMINI_API_KEY: 'chiave-reale-non-segnaposto',
        FEATURE_PAYMENTS: 'false',
        FEATURE_SUBSCRIPTIONS: 'false'
      },
      () => {
        expect(() => assertProductionEnv()).toThrow(/DEV_OUTBOX/);
      }
    );
  });

  it('assertProductionEnv() passa quando DEV_OUTBOX non c\'è', () => {
    conAmbiente(
      {
        NODE_ENV: 'production',
        DEV_OUTBOX: undefined,
        MONGODB_URI: 'mongodb://esempio/db',
        FRONTEND_URL: 'https://esempio.test',
        JWT_SECRET: 'un_segreto_abbastanza_lungo_per_la_soglia_0000',
        GEMINI_API_KEY: 'chiave-reale-non-segnaposto',
        FEATURE_PAYMENTS: 'false',
        FEATURE_SUBSCRIPTIONS: 'false'
      },
      () => {
        expect(() => assertProductionEnv()).not.toThrow();
      }
    );
  });
});
