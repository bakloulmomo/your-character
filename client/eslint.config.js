import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/**
 * Configurazione ESLint (FASE E — punto 6).
 *
 * Lo script `npm run lint` esisteva da sempre e puntava a uno strumento che non
 * era installato: eseguirlo dava `eslint: command not found`. È la stessa forma
 * dei difetti trovati altrove — qualcosa di dichiarato che non è collegato a
 * nulla — e sarebbe passata inosservata in CI come "passo verde".
 *
 * Le regole scelte sono quelle che trovano difetti veri, non quelle di stile:
 * le dipendenze mancanti negli hook e le variabili non usate hanno prodotto
 * bug reali in questo progetto. La formattazione non è compito del linter.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2021 }
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      /**
       * `set-state-in-effect` è disattivata deliberatamente.
       *
       * Segnala il caricamento dei dati al montaggio — «carica, poi imposta lo
       * stato» — che in questo progetto è il modo in cui funzionano TUTTI gli
       * hook di `src/hooks/`. Non è un difetto: è l'architettura scelta in FASE
       * C, dove gli stati espliciti di caricamento/errore/vuoto sono proprio la
       * correzione di S3-12.
       *
       * Rispettarla richiederebbe una libreria di data fetching (React Query,
       * SWR) o Suspense: un cambiamento architetturale legittimo ma che non
       * appartiene a una fase dedicata ai test. Lasciarla accesa avrebbe reso
       * il linter inutilizzabile — sette errori su codice corretto — e la via
       * di mezzo (sopprimerla riga per riga) avrebbe nascosto la decisione.
       */
      'react-hooks/set-state-in-effect': 'off',

      // `any` è usato di proposito sulle risposte di axios, dove la forma è
      // decisa dal server: segnalarlo come errore produrrebbe solo rumore.
      '@typescript-eslint/no-explicit-any': 'off',
      // Un argomento non usato che inizia con `_` è deliberato.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }]
    }
  },

  // I file di test e di configurazione girano in Node e hanno le proprie globali.
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**', 'e2e/**', '*.config.{ts,js}', 'scripts/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-console': 'off' }
  }
);
