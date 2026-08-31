/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // Design system "Blue & Black / Sapphire" — quello previsto dal piano di
      // architettura e mai realizzato. Sostituisce la palette zinc improvvisata
      // dell'app e il tema slate scollegato delle pagine legali.
      colors: {
        // Scala di elevazione, dal piu' profondo al piu' vicino. E' monotona:
        // ogni gradino e' piu' chiaro del precedente. Prima `surface.sunken`
        // (#0A0E18) era piu' CHIARO del fondo pagina (#060913), quindi un campo
        // di testo «incassato» sporgeva dalla pagina invece di rientrarci.
        bg: {
          DEFAULT: '#05070E',   // fondo pagina
          elevated: '#0A0E17'   // barre laterali, intestazioni, pannelli
        },
        surface: {
          DEFAULT: '#111827',   // schede e riquadri appoggiati sul fondo
          hover: '#182234',
          sunken: '#0B111E'     // campi di testo: piu' scuri della scheda che li ospita
        },
        line: {
          DEFAULT: '#1E293B',
          strong: '#2C3B52'
        },
        // `dim` era #64748B: 4.2:1 sul fondo, sotto il minimo di 4.5:1 — ed era
        // il colore applicato al testo piu' piccolo dell'interfaccia, dove il
        // contrasto conta di piu'. Ora sta a 6.5:1.
        ink: {
          DEFAULT: '#F8FAFC',
          muted: '#9FB0C6',
          dim: '#8496AE'
        },
        sapphire: {
          DEFAULT: '#2563EB',
          hover: '#3B82F6',
          glow: '#60A5FA',
          deep: '#1D4ED8',
          wash: 'rgba(37, 99, 235, 0.12)'
        },
        danger: '#EF4444',
        success: '#10B981',
        warning: '#F59E0B'
      },
      /**
       * Un solo gradino sotto `text-xs`, e non piu' basso di 11px.
       *
       * Il codice usava `text-[9px]`, `text-[10px]` e `text-[11px]` in 54
       * punti: tre misure arbitrarie inventate una alla volta, tutte sotto la
       * soglia in cui un testo resta leggibile, e quasi sempre colorate con il
       * grigio piu' debole della tavolozza. Le tre misure diventano una sola,
       * dichiarata qui, con la sua interlinea.
       */
      fontSize: {
        micro: ['0.6875rem', { lineHeight: '1rem' }]
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Outfit', 'Inter', 'sans-serif'],
        /**
         * Monospazio di sistema, non piu' un terzo carattere scaricato.
         *
         * JetBrains Mono veniva usato su 42 elementi che non sono codice: il
         * saluto della home, i nomi utente, i conteggi, gli orari, le etichette
         * di sezione. Il monospazio su testo normale non aggiunge significato,
         * lo rende solo piu' difficile da leggere e piu' largo. Resta dov'e'
         * davvero codice — i prompt grezzi nella coda di moderazione e il nome
         * del cookie nell'informativa — e per quei pochi punti il carattere di
         * sistema basta, senza una terza richiesta di rete al primo caricamento.
         */
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      keyframes: {
        // Queste animazioni erano usate in 14 punti e non esistevano.
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-4px)' },
          '40%, 80%': { transform: 'translateX(4px)' }
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        // Le notifiche entrano dall'alto: da quando stanno in alto a destra,
        // un ingresso dal basso le farebbe risalire contro il loro bordo.
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-12px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'pulse-dot': {
          '0%, 80%, 100%': { opacity: '0.25' },
          '40%': { opacity: '1' }
        }
      },
      animation: {
        'fade-in': 'fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        shake: 'shake 0.4s ease-in-out',
        'slide-up': 'slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-down': 'slide-down 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-dot': 'pulse-dot 1.2s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
