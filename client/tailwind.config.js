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
        bg: {
          DEFAULT: '#060913',   // fondo profondo
          elevated: '#0B0F19'   // barre e superfici di primo livello
        },
        surface: {
          DEFAULT: '#111827',
          hover: '#162032',
          sunken: '#0A0E18'
        },
        line: {
          DEFAULT: '#1E293B',
          strong: '#2C3B52'
        },
        ink: {
          DEFAULT: '#F8FAFC',
          muted: '#94A3B8',
          dim: '#64748B'
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
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Outfit', 'Inter', 'sans-serif'],
        // Caricato davvero in index.html: prima era dichiarato qui e usato su
        // decine di elementi senza che il font venisse mai scaricato.
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace']
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
