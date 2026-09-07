/** @type {import('tailwindcss').Config} */

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SISTEMA DI DESIGN — «Notturno»
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Il prodotto è un CAST. I personaggi sono il contenuto; l'interfaccia è la
 * sala che si spegne perché tu li veda.
 *
 * Sostituisce «Rivista», il sistema editoriale precedente. Non perché fosse
 * sbagliato — era coerente e ben motivato — ma perché era applicato a un terzo
 * dell'applicazione: cinque file lo seguivano, nove pagine usavano attivamente
 * i pattern che i suoi stessi commenti dichiaravano aboliti. Un sistema
 * contraddetto dal codice che dovrebbe governare non è un sistema.
 *
 * Tre regole operative, e sotto ciascuna il meccanismo che la fa rispettare —
 * perché è quello, non la buona volontà, a decidere se fra tre mesi il rapporto
 * sarà ancora un terzo.
 *
 *  1. IL RITRATTO È IL CONTENUTO, L'INTERFACCIA È BUIO. Le immagini vanno a
 *     tutto sangue, ad alto contrasto, in ritaglio rettangolare. Nessun
 *     ritratto dentro un cerchio: il cerchio è il segnale più riconoscibile di
 *     «applicazione qualsiasi». Tutto il resto arretra verso il nero.
 *
 *  2. UN SOLO COLORE INVITA AD AGIRE. Il blu del marchio marca ciò su cui si
 *     può premere: azione primaria, collegamenti, anello di fuoco. I colori
 *     semantici esistono, ma RIFERISCONO uno stato e non invitano mai — ed è
 *     per questo che `warning` è rimasto un token separato invece di
 *     collassare nell'accento: l'avviso di sicurezza in `MessageBubble` non
 *     può avere il colore del pulsante «Invia».
 *
 *  3. DUE CARATTERI, DUE MESTIERI. Archivo compresso in peso alto è l'INSEGNA —
 *     nomi, titoli, il vertice della pagina. Schibsted Grotesk è l'ATTREZZATURA
 *     — pulsanti, campi, etichette, metadati, e la prosa delle conversazioni.
 *     Il serif esce: era la voce di «Rivista», la voce di «Notturno» è la
 *     locandina.
 *
 * VERIFICATO, NON DICHIARATO. `scripts/check-contrast.mjs` LEGGE questo file —
 * non ne ricopia i valori, come faceva prima — e misura ogni coppia che
 * l'interfaccia produce davvero, più la monotonia della scala di elevazione.
 * `scripts/check-scale.mjs` fallisce se una pagina reintroduce un corpo fuori
 * scala, un colore fuori tavolozza o un'ombra fuori token. Entrambi girano in
 * CI. Le trentaquattro violazioni che «Rivista» aveva accumulato non possono
 * tornare.
 */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /**
         * La sala. Cinque gradini, tutti sotto l'un percento di luminanza:
         * la profondità si percepisce, non si vede. `surface.sunken` è più
         * CHIARO del fondo pagina di un soffio — un campo di testo su un nero
         * pieno sparirebbe, e la scala di elevazione è verificata in
         * quell'ordine preciso dallo script.
         */
        bg: {
          DEFAULT: '#08080B',
          elevated: '#0E0E13'
        },
        surface: {
          DEFAULT: '#131319',
          hover: '#1A1A21',
          sunken: '#0B0B0F'
        },
        /**
         * Tre fili, e la distinzione fra loro NON è estetica: è la ragione per
         * cui il controllo di contrasto ha smesso di mentire.
         *
         * `line` e `line.strong` separano — decorazione: se sparissero, il
         * contenuto resterebbe comprensibile, e WCAG 1.4.11 non li riguarda.
         * `line.control` disegna il bordo di un campo o di un pulsante, dove la
         * linea è l'unica cosa che dice dove si può scrivere o premere: quella
         * ricade sotto la soglia 3:1 e la rispetta (3.09:1 sul fondo).
         *
         * Prima esistevano solo i primi due, e il controllo li verificava con
         * una soglia abbassata a 1.5 — un numero senza fondamento, scelto per
         * far passare un colore che a 3.0 non passava. Un campo il cui bordo
         * ha 1.15:1 non ha un bordo.
         */
        line: {
          DEFAULT: '#201F28',
          strong: '#37363F',
          control: '#5E5D68'
        },
        ink: {
          DEFAULT: '#F4F4F7',
          muted: '#9E9DA8',
          dim: '#7E7D88'
        },
        /**
         * Il blu del marchio: lo stesso `#0D60FE` del logo, misurato sul file
         * invece che scelto a occhio. L'accento dell'interfaccia e il segno che
         * sta sulla scheda del browser sono ora lo stesso colore.
         *
         * Ne discende un vincolo che NON è una preferenza, ed è l'opposto di
         * quello dell'ambra che stava qui prima. Questo blu è PROFONDO: col
         * nero della sala dà 3.93:1 e non regge un testo scuro sopra; con
         * l'inchiostro dà 4.64:1 e passa. Il pulsante primario porta quindi
         * testo CHIARO — imposto dalla misura, come lo era il suo contrario.
         *
         * Per la stessa ragione l'hover SCENDE invece di salire. Schiarire il
         * riempimento abbasserebbe il contrasto con l'inchiostro che ci sta
         * sopra — due gradini di luminosità in più e si è già a 4.42:1, sotto
         * la soglia — quindi l'unico verso in cui questo pulsante può
         * rispondere al mouse è il blu più fondo.
         */
        accent: {
          DEFAULT: '#0D60FE',   // il blu del logo: 4.64:1 con l'inchiostro sopra
          hover: '#0A55E6',     // 5.54:1 — più fondo, non più chiaro
          glow: '#7BA8FE',      // collegamenti e anello di fuoco: 8.45:1
          wash: 'rgba(13, 96, 254, 0.10)'
        },
        /**
         * Riferiscono uno stato, non invitano ad agire. Nessuno dei tre
         * comunica mai col solo colore — sempre un'icona o una parola accanto,
         * perché in deuteranopia il rosso di `danger` e il giallo di `warning`
         * si avvicinano fra loro. Dall'accento, ora che è blu, entrambi
         * restano distinti: è l'unico vincolo che il cambio di tinta ha
         * allentato, non una ragione per fidarsi del colore da solo.
         *
         * `warning` resta deliberatamente giallo pallido e non ocra: era nato
         * per non somigliare all'ambra dell'accento, e continua a servire
         * perché un avviso di sicurezza non deve somigliare a un pulsante.
         */
        danger: '#FF4D5E',
        success: '#2FBF87',
        warning: '#E3D06B'
      },

      /**
         Raggi quasi assenti. Locandine, fotogrammi e sottotitoli sono
         rettangolari. In «Rivista» il valore massimo era 12px e `rounded-xl`
         compariva 109 volte in un sistema che dichiarava di volere raggi
         piccoli: qui il raggio non è più una scelta di chi scrive la pagina,
         perché lo porta il componente.
       */
      borderRadius: {
        sm: '2px',
        DEFAULT: '3px',
        md: '4px',
        lg: '6px',
        xl: '8px',
        '2xl': '10px'
      },

      /**
       * Nove misure, e un vertice che prima non esisteva.
       *
       * `display-xl` è l'insegna: una pagina che si apre con 80px di Archivo
       * compresso dice al primo sguardo che qualcuno ha deciso qualcosa. In
       * «Rivista» il massimo era 40px, usato una volta sola in tutta
       * l'applicazione mentre otto pagine componevano il proprio titolo con
       * `text-2xl` — una misura che non apparteneva nemmeno alla scala.
       *
       * `read` sale da 16 a 17px: la prosa delle conversazioni ha perso il
       * serif e ha bisogno di un filo di corpo in più.
       */
      fontSize: {
        micro: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
        xs: ['0.75rem', { lineHeight: '1.15rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.9375rem', { lineHeight: '1.6' }],
        read: ['1.0625rem', { lineHeight: '1.75' }],
        'display-sm': ['1.5rem', { lineHeight: '1.1', letterSpacing: '-0.01em' }],
        'display-md': ['2.25rem', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        'display-lg': ['3.5rem', { lineHeight: '0.98', letterSpacing: '-0.03em' }],
        'display-xl': ['5rem', { lineHeight: '0.92', letterSpacing: '-0.035em' }]
      },

      fontFamily: {
        /** L'attrezzatura, e la prosa: pulsanti, campi, etichette, messaggi. */
        sans: ['"Schibsted Grotesk"', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        /**
         * L'insegna. Archivo ha l'asse di LARGHEZZA variabile (`wdth`): la
         * compressione è un'impostazione, non un secondo file da scaricare.
         * Non è Bebas e non è Oswald, che sono il primo risultato di qualunque
         * generatore e si riconoscono a distanza.
         */
        display: ['Archivo', 'Archivo Narrow', 'Helvetica Neue', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },

      /** Ombre solo per ciò che galleggia davvero: modali e menu. */
      boxShadow: {
        overlay: '0 32px 64px -24px rgba(0, 0, 0, 0.92)',
        popover: '0 16px 32px -12px rgba(0, 0, 0, 0.82)'
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
       * durate sotto i due decimi di secondo. Erano già giuste: non si toccano.
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
