/** @type {import('tailwindcss').Config} */

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SISTEMA DI DESIGN — «Rivista»
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * La revisione precedente aveva sostituito i valori predefiniti con valori
 * scelti, il che era necessario ma non sufficiente: restavano troppe cose
 * accese contemporaneamente. Una scheda personaggio mostrava ritratto,
 * sfumatura, nome, autore, descrizione, due etichette colorate e un contatore —
 * sette elementi per dire una cosa sola. Il colore compariva ovunque: etichette
 * azzurre, stato attivo azzurro, pulsanti azzurri, collegamenti azzurri.
 *
 * Il principio di questa revisione è uno solo, e viene dal design editoriale:
 * LA GERARCHIA LA FANNO IL TESTO E LO SPAZIO, NON I RIQUADRI E I COLORI.
 *
 * Tre regole operative, verificabili leggendo il codice:
 *
 *  1. IL COLORE È RARO. L'accento serve a tre cose e basta — l'azione primaria,
 *     i collegamenti, l'anello di fuoco. Non colora etichette, stati attivi o
 *     decorazioni: dove prima c'era una tinta ora c'è un peso tipografico
 *     diverso. I colori semantici (errore, riuscita, avviso) restano, ma solo
 *     dove portano un significato che il testo da solo non porta.
 *
 *  2. NIENTE SCATOLE INTORNO A TUTTO. Le superfici sono vicinissime fra loro
 *     (da #0A0A0C a #1A1A1E: cinque gradini in tre punti percentuali di
 *     luminanza). Una scheda non è un rettangolo evidenziato, è un blocco di
 *     testo con dello spazio intorno. Dove serve una separazione si usa un
 *     filo, non un bordo chiuso.
 *
 *  3. DUE CARATTERI CON UN CONFINE NETTO. Il serif è la VOCE — nomi dei
 *     personaggi, titoli, testo delle conversazioni. Il grottesco è
 *     l'ATTREZZATURA — pulsanti, etichette, metadati. Nessuno dei due invade il
 *     campo dell'altro, così il lettore capisce dal carattere se sta leggendo
 *     il prodotto o il contenuto.
 *
 * I contrasti non sono affidati al buon gusto: `scripts/check-contrast.mjs`
 * misura 26 coppie e la monotonia della scala, e sta dentro `npm run verify`.
 */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /**
         * Cinque gradini quasi indistinguibili, di proposito.
         *
         * Prima andavano da #08090D a #1C2029, con `surface` visibilmente più
         * chiara del fondo: ogni scheda diventava un rettangolo che si
         * annunciava. Qui la differenza fra fondo e superficie è di quattro
         * millesimi di luminanza — si percepisce come profondità, non come
         * bordo. È il fondo di una pagina stampata, non un pannello.
         */
        bg: {
          DEFAULT: '#0A0A0C',
          elevated: '#0F0F12'
        },
        surface: {
          DEFAULT: '#141417',
          hover: '#1A1A1E',
          sunken: '#0C0C0E'
        },
        /** Fili, non bordi: `line` separa, `line.strong` risponde al mouse. */
        line: {
          DEFAULT: '#1F1F24',
          strong: '#34343C'
        },
        ink: {
          DEFAULT: '#EDEDF0',
          muted: '#A2A2AC',
          dim: '#87878F'
        },
        /**
         * L'unico colore dell'interfaccia, e compare tre volte in tutto.
         *
         * Non è cambiato di tinta rispetto a prima — è cambiato quanto lo si
         * usa. Il difetto non era il blu: era il blu su etichette, su stati
         * attivi, su fondi, su bordi e su testo contemporaneamente.
         */
        accent: {
          DEFAULT: '#1A6FBE',   // riempimenti: 5.17:1 col bianco
          hover: '#1F76C4',     // 4.72:1 — sopra la soglia anche da acceso
          glow: '#63B3F0',      // collegamenti e anello di fuoco
          deep: '#124C82',
          wash: 'rgba(26, 111, 190, 0.10)'
        },
        danger: '#F2555A',
        success: '#2FBF87',
        warning: '#E0A33E'
      },

      /**
       * Raggi piccoli. Un'interfaccia editoriale non è fatta di pastiglie:
       * l'arrotondamento serve ad ammorbidire un angolo, non a firmare uno
       * stile. Il valore più grande qui (12px, per i modali) era il valore
       * MEDIO della versione precedente.
       */
      borderRadius: {
        sm: '2px',
        DEFAULT: '4px',
        md: '6px',
        lg: '8px',
        xl: '10px',
        '2xl': '12px'
      },

      /**
       * Sette misure per tutta l'applicazione, ciascuna con la sua interlinea
       * e la sua crenatura. Prima le misure arbitrarie in linea
       * (`text-[0.8125rem]`, `text-[1.0625rem]`, `text-[0.9375rem]`) erano
       * sparse in decine di punti: ogni componente inventava la propria scala,
       * ed è così che due titoli fratelli finiscono di due corpi diversi.
       */
      fontSize: {
        micro: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
        xs: ['0.75rem', { lineHeight: '1.15rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.9375rem', { lineHeight: '1.6' }],
        // La prosa delle conversazioni: è il testo su cui si passa il tempo.
        read: ['1rem', { lineHeight: '1.7' }],
        'display-sm': ['1.3125rem', { lineHeight: '1.25', letterSpacing: '-0.01em' }],
        'display-md': ['1.75rem', { lineHeight: '1.15', letterSpacing: '-0.015em' }],
        'display-lg': ['2.5rem', { lineHeight: '1.05', letterSpacing: '-0.022em' }]
      },

      fontFamily: {
        /** L'attrezzatura: pulsanti, campi, etichette, metadati. */
        sans: ['"Schibsted Grotesk"', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        /** La voce: nomi, titoli, e il testo delle conversazioni. */
        display: ['Newsreader', 'Iowan Old Style', 'Georgia', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },

      /** Ombre solo per ciò che galleggia davvero: modali e menu. */
      boxShadow: {
        overlay: '0 32px 64px -24px rgba(0, 0, 0, 0.9)',
        popover: '0 16px 32px -12px rgba(0, 0, 0, 0.8)'
      },

      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-3px)' },
          '40%, 80%': { transform: 'translateX(3px)' }
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'pulse-dot': { '0%, 80%, 100%': { opacity: '0.2' }, '40%': { opacity: '1' } }
      },
      /**
       * Il movimento comunica uno stato, non si fa guardare. Una sola curva,
       * durate sotto i due decimi di secondo. La traslazione d'ingresso è
       * scesa da 12px a 6px: quanto basta perché l'occhio registri l'arrivo.
       */
      animation: {
        'fade-in': 'fade-in 0.16s cubic-bezier(0.2, 0, 0, 1)',
        shake: 'shake 0.35s ease-in-out',
        'slide-up': 'slide-up 0.18s cubic-bezier(0.2, 0, 0, 1)',
        'slide-down': 'slide-down 0.18s cubic-bezier(0.2, 0, 0, 1)',
        'pulse-dot': 'pulse-dot 1.2s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
