import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Eye, EyeOff, Check, Loader2, ArrowLeft, MailCheck, ChevronDown, AlertCircle } from 'lucide-react';
import api from '../services/api';
import { useStore } from '../store/useStore';
import Modal from './ui/Modal';
import CodeInput from './ui/CodeInput';
import { errorMessage } from '../lib/apiError';

type View = 'login' | 'register' | 'verify' | 'forgot' | 'sent';
type Mode = 'login' | 'register';

/**
 * `authModalMode` puo' valere anche `'verify'`: e' come la striscia in cima
 * all'applicazione riapre la conferma senza far ripassare dall'accesso.
 */

const MONTHS = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
];

const currentYear = new Date().getUTCFullYear();
const YEARS = Array.from({ length: 100 }, (_, i) => currentYear - 18 - i);

const TABS: ReadonlyArray<{ key: Mode; label: string }> = [
  { key: 'login', label: 'Accedi' },
  { key: 'register', label: 'Registrati' }
];

const PANEL_ID = 'auth-panel';
const RULES_ID = 'auth-password-rules';

/**
 * Un indirizzo plausibile. Non è una convalida definitiva — quella la fa il
 * server, ed è l'unica che conta — ma è sufficiente a dire subito «questo non
 * arriverà mai a destinazione» invece di farlo scoprire dopo l'invio.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

/**
 * Quanti giorni ha davvero il mese scelto.
 *
 * Prima l'elenco arrivava sempre a 31: il 31 febbraio era selezionabile e
 * l'errore compariva solo DOPO l'invio, in un banner rosso in cima al modulo.
 * Un campo non deve permettere di comporre un valore che poi rifiuterà.
 *
 * Senza l'anno si resta permissivi (29 a febbraio): il vincolo esatto arriva
 * quando l'anno c'è, e a quel punto un giorno diventato impossibile viene
 * tolto invece di restare selezionato di nascosto.
 */
function daysInMonth(month: string, year: string): number {
  if (month === '') return 31;
  const y = year === '' ? 2000 : Number(year);
  return new Date(Date.UTC(y, Number(month) + 1, 0)).getUTCDate();
}

/* ────────────────────────────────────────────────────────────────────────────
 * Sottocomponenti — dichiarati QUI, al livello del modulo.
 *
 * Non è pignoleria stilistica: un componente definito dentro il corpo di un
 * altro componente è una funzione NUOVA a ogni render, quindi per React è un
 * TIPO nuovo. React non lo riconcilia: smonta il vecchio sottoalbero e ne
 * monta uno nuovo. Il campo di testo che stava lì dentro viene distrutto e
 * ricreato a ogni carattere digitato — e con lui se ne va il fuoco.
 *
 * È la stessa famiglia del difetto appena corretto in `ui/Modal.tsx`, per una
 * strada diversa. Tenendoli qui il problema non può ripresentarsi.
 * ──────────────────────────────────────────────────────────────────────────── */

interface FieldProps {
  id: string;
  label: string;
  /** Testo di aiuto permanente: dice cosa serve, non cosa è andato storto. */
  hint?: ReactNode;
  /** Messaggio d'errore. Quando c'è, sostituisce l'aiuto. */
  error?: string;
  /** Comando allineato all'etichetta (es. «Password dimenticata?»). */
  action?: ReactNode;
  children: ReactNode;
}

function Field({ id, label, hint, error, action, children }: FieldProps) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold leading-none text-ink">
          {label}
        </label>
        {action}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-2 flex items-start gap-1.5 text-xs font-medium leading-relaxed text-danger">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-2 text-xs font-normal leading-relaxed text-ink-dim">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface SelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  children: ReactNode;
}

/** `<select>` nativo con la freccia del tema al posto di quella del browser. */
function Select({ label, value, onChange, invalid, children }: SelectProps) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="input-field appearance-none pr-9"
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-dim"
        aria-hidden="true"
      />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────── */

/**
 * Chi nasce dopo questo istante non ha ancora diciotto anni. Catturato una
 * volta sola, fuori dal render: una costante, non una lettura dell'orologio.
 */
const MAGGIORE_ETA = (() => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear() - 18, d.getUTCMonth(), d.getUTCDate());
})();

export default function AuthModal() {
  const { isAuthModalOpen, authModalMode, setAuthModalOpen, setUser, setToken, notify, inviteRequired } = useStore();

  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  /** Conferma dell'indirizzo: il codice digitato e il freno al rinvio. */
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);

  /**
   * Quali campi l'utente ha già lasciato.
   *
   * La validazione istantanea non deve accusare mentre si scrive: alla prima
   * lettera un indirizzo è incompleto per forza, e segnarlo in rosso è un
   * rimprovero per non aver ancora finito. Si segnala all'uscita dal campo, e
   * da quel momento in poi si corregge in tempo reale mentre si rimedia.
   */
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const markTouched = (name: string) => setTouched((t) => ({ ...t, [name]: true }));

  const passwordRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Partial<Record<Mode, HTMLButtonElement | null>>>({});

  /**
   * Stato pulito a ogni apertura.
   *
   * Prima `close()` azzerava solo password ed errore: nome utente, data di
   * nascita e codice d'invito sopravvivevano alla chiusura e riapparivano
   * all'apertura successiva. Si azzera all'APERTURA e non alla chiusura, così
   * i campi non si svuotano sotto gli occhi durante l'animazione di uscita.
   */
  useEffect(() => {
    if (!isAuthModalOpen) return;
    setView(authModalMode);
    setEmail('');
    setUsername('');
    setPassword('');
    setShowPassword(false);
    setDay('');
    setMonth('');
    setYear('');
    setInviteCode('');
    setCode('');
    setResendIn(0);
    setTouched({});
    setError('');
    setLoading(false);
  }, [isAuthModalOpen, authModalMode]);

  /**
   * Conto alla rovescia del rinvio.
   *
   * Il freno vero vive sul server e guarda il dato salvato — questo è solo il
   * modo di dirlo prima di far premere un pulsante che risponderebbe «troppo
   * presto». Un pulsante attivo che rifiuta è peggio di un pulsante spento che
   * spiega quando tornerà disponibile.
   */
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const close = useCallback(() => setAuthModalOpen(false), [setAuthModalOpen]);

  // ── Validazione ───────────────────────────────────────────────────────────

  const rules = useMemo(
    () => [
      { ok: password.length >= 8, label: 'Almeno 8 caratteri' },
      { ok: /[A-Z]/.test(password), label: 'Una lettera maiuscola' },
      { ok: /[0-9]/.test(password), label: 'Un numero' }
    ],
    [password]
  );
  const passwordScore = rules.filter((r) => r.ok).length;
  const passwordValid = passwordScore === rules.length;

  const emailValid = EMAIL_RE.test(email);
  const usernameValid = USERNAME_RE.test(username);

  const dayCount = daysInMonth(month, year);

  /** Un giorno reso impossibile dal mese scelto non resta selezionato. */
  useEffect(() => {
    if (day !== '' && Number(day) > dayCount) setDay('');
  }, [dayCount, day]);

  const birthdate = useMemo(() => {
    if (!day || !month || !year) return null;
    return new Date(Date.UTC(Number(year), Number(month), Number(day)));
  }, [day, month, year]);

  /**
   * Maggiore età, calcolata su un istante catturato all'import del modulo.
   *
   * Era `Date.now()` letto durante il render, e `react-hooks/purity` lo
   * segnalava — a ragione: un render che legge l'orologio non è riproducibile,
   * e con il compilatore di React può essere memoizzato con un valore vecchio.
   * L'ora esatta qui non serve a nulla: la soglia è una data di diciotto anni
   * fa, e non si sposta mentre qualcuno compila un modulo.
   */
  const underage = birthdate !== null && birthdate.getTime() > MAGGIORE_ETA;

  const emailError = touched.email && email !== '' && !emailValid ? 'Indirizzo email non valido.' : '';
  const usernameError =
    touched.username && username !== '' && !usernameValid
      ? 'Da 3 a 30 caratteri: solo lettere, numeri e underscore.'
      : '';
  const birthdateError = underage ? 'Devi avere almeno 18 anni per registrarti.' : '';

  // ── Invio ─────────────────────────────────────────────────────────────────

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setTouched({ email: true, password: true });
    if (!emailValid || password === '') {
      setError('Compila email e password per continuare.');
      return;
    }

    setError('');
    setLoading(true);

    /**
     * Nel `try` sta SOLO la chiamata di rete.
     *
     * Prima comprendeva anche gli aggiornamenti di stato che seguono il
     * successo. Un'eccezione sollevata lì dentro — un campo mancante nella
     * risposta, una funzione dello store cambiata di forma — veniva raccolta
     * dallo stesso `catch` e mostrata come «Accesso non riuscito»: all'utente
     * si dichiarava fallita un'operazione che il server aveva completato. Nel
     * caso della registrazione è peggio ancora, perché invita a riprovare un
     * account che esiste già.
     */
    let res;
    try {
      res = await api.post('/auth/login', { email, password });
    } catch (err: unknown) {
      setError(errorMessage(err, 'Accesso non riuscito.'));
      setLoading(false);
      return;
    }

    setLoading(false);
    setToken(res.data.token);
    setUser(res.data.user);
    notify(`Bentornato, @${res.data.user.username}.`, 'success');
    close();
  };

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setTouched({ email: true, username: true, password: true, birthdate: true });

    if (!emailValid) {
      setError('Controlla l\'indirizzo email.');
      return;
    }
    if (!usernameValid) {
      setError('Il nome utente non rispetta il formato richiesto.');
      return;
    }
    if (!passwordValid) {
      setError('La password non rispetta i requisiti.');
      passwordRef.current?.focus();
      return;
    }
    if (!birthdate) {
      setError('Inserisci la tua data di nascita.');
      return;
    }
    // L'età si verifica anche qui, oltre che sul server: l'app ospita
    // contenuti per adulti e la data va controllata prima dell'invio.
    if (underage) {
      setError('Devi avere almeno 18 anni per registrarti.');
      return;
    }
    if (inviteRequired && inviteCode.trim() === '') {
      setError('Serve un codice d\'invito per registrarsi durante la beta.');
      return;
    }

    setError('');
    setLoading(true);

    // Come in `login`: nel `try` solo la rete. Dichiarare fallita una
    // registrazione riuscita spinge l'utente a ricrearsi un account che esiste.
    let res;
    try {
      res = await api.post('/auth/register', {
        email,
        username,
        password,
        birthdate: `${year}-${String(Number(month) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        // Inviato solo quando serve: il server ignora il campo se la beta e' aperta.
        ...(inviteRequired ? { inviteCode: inviteCode.trim() } : {})
      });
    } catch (err: unknown) {
      setError(errorMessage(err, 'Registrazione non riuscita.'));
      setLoading(false);
      return;
    }

    setLoading(false);
    setToken(res.data.token);
    setUser(res.data.user);

    /**
     * Il saldo annunciato è quello che il server ha DAVVERO assegnato.
     *
     * Qui c'era scritto «Hai 10 crediti per cominciare», un numero fisso.
     * Ma `welcomeCredits()` (server/config/env.js) restituisce 10 solo con i
     * pagamenti attivi: in beta gratuita — la configurazione in cui l'app gira
     * oggi — ne assegna 100. Il primo messaggio che l'utente leggeva dopo
     * l'iscrizione sottostimava di dieci volte quello che aveva ricevuto, e
     * nessun test se ne accorgeva perché il numero era scritto a mano su
     * entrambi i lati del confronto.
     */
    const credits = res.data.user?.credits;
    notify(
      typeof credits === 'number'
        ? `Account creato. Hai ${credits} crediti per cominciare.`
        : 'Account creato.',
      'success'
    );

    /**
     * Non si chiude: si passa alla conferma.
     *
     * L'account esiste e la sessione e' aperta — si puo' gia' guardare il
     * catalogo — ma senza indirizzo confermato non si scrive, e scoprirlo piu'
     * tardi sbattendo contro un 403 al primo messaggio sarebbe il modo peggiore
     * di dirlo. Il codice e' appena partito: il momento in cui l'utente e' piu'
     * disposto a inserirlo e' adesso, non fra dieci minuti.
     *
     * Chiudere resta possibile: `Modal` ha la sua X e il suo Esc, e la striscia
     * in cima all'applicazione riporta qui.
     */
    if (res.data.user && res.data.user.emailVerified === false) {
      setView('verify');
      return;
    }
    close();
  };

  /**
   * Conferma il codice.
   *
   * L'errore NON svuota il campo: chi ha sbagliato una cifra deve poter
   * correggere quella, non riscrivere tutto. Svuotare dopo un errore è il modo
   * più rapido di trasformare un refuso in un abbandono.
   */
  const confirmCode = async (valore?: string) => {
    const daInviare = (valore ?? code).trim();
    if (loading || daInviare.length !== 6) return;

    setError('');
    setLoading(true);

    let res;
    try {
      res = await api.post('/auth/verify-email', { code: daInviare });
    } catch (err: unknown) {
      setError(errorMessage(err, 'Codice non valido.'));
      setLoading(false);
      return;
    }

    setLoading(false);
    setUser(res.data.user);
    notify('Indirizzo confermato. Ora puoi scrivere.', 'success');
    close();
  };

  const resendCode = async () => {
    if (loading || resendIn > 0) return;

    setError('');
    setLoading(true);
    try {
      await api.post('/auth/resend-verification');
      notify('Ti abbiamo inviato un nuovo codice.', 'success');
      // Sessanta secondi: lo stesso freno che applica il server, mostrato
      // invece che scoperto sbattendoci contro.
      setResendIn(60);
      setCode('');
    } catch (err: unknown) {
      setError(errorMessage(err, 'Non siamo riusciti a inviare il codice.'));
    }
    setLoading(false);
  };

  const requestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setTouched({ email: true });
    if (!emailValid) {
      setError('Controlla l\'indirizzo email.');
      return;
    }

    setError('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
    } catch (err: unknown) {
      setError(errorMessage(err, 'Richiesta non riuscita.'));
      setLoading(false);
      return;
    }

    setLoading(false);
    setView('sent');
  };

  // ── Selettore Accedi / Registrati ─────────────────────────────────────────

  const selectTab = (mode: Mode) => {
    setView(mode);
    setError('');
  };

  /**
   * Frecce, Home e Fine, come prevede il modello «tablist» dell'ARIA APG.
   *
   * Prima i due pulsanti dichiaravano `role="tab"` senza nulla di ciò che quel
   * ruolo promette: nessun `tabpanel`, nessun `aria-controls`, nessuna
   * navigazione con le frecce e due elementi entrambi raggiungibili con Tab.
   * Annunciare «scheda 1 di 2» e poi non rispondere alle frecce è peggio che
   * non annunciarlo affatto: l'etichetta ARIA è una promessa di comportamento.
   */
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const index = TABS.findIndex((t) => t.key === view);
    if (index === -1) return;

    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next === -1) return;

    e.preventDefault();
    const target = TABS[next].key;
    selectTab(target);
    // I due pulsanti sono già montati: il fuoco può seguire subito la
    // selezione, senza attendere il render che aggiornerà `tabIndex`.
    tabRefs.current[target]?.focus();
  };

  const titles: Record<View, string> = {
    login: 'Accedi',
    register: 'Crea un account',
    verify: 'Conferma il tuo indirizzo',
    forgot: 'Recupera la password',
    sent: 'Controlla la posta'
  };

  const descriptions: Partial<Record<View, string>> = {
    login: 'Riprendi le tue conversazioni da dove le avevi lasciate.',
    register: 'Bastano pochi secondi per cominciare.',
    verify: 'Ti abbiamo inviato un codice di sei cifre.'
  };

  const isMode = view === 'login' || view === 'register';

  return (
    <Modal open={isAuthModalOpen} onClose={close} title={titles[view]} description={descriptions[view]}>
      {error && (
        <div
          role="alert"
          className="animate-shake mb-5 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/[0.09] px-4 py-3 text-sm font-medium leading-relaxed text-danger"
        >
          <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      {view === 'verify' && (
        <div className="py-1">
          <p className="mb-6 text-center text-sm leading-relaxed text-ink-muted">
            Abbiamo scritto a <strong className="font-semibold text-ink">{email}</strong>.
            Inserisci il codice che trovi nel messaggio.
          </p>

          <CodeInput
            value={code}
            onChange={setCode}
            onComplete={confirmCode}
            disabled={loading}
            invalid={!!error}
          />

          <p className="mt-4 text-center text-xs text-ink-dim">Il codice vale 15 minuti.</p>

          <button
            type="button"
            onClick={() => confirmCode()}
            disabled={loading || code.length !== 6}
            className="btn-primary mt-6 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Conferma
          </button>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={resendCode}
              disabled={loading || resendIn > 0}
              className="btn-ghost rounded-lg px-2 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              {resendIn > 0 ? `Puoi chiederne un altro fra ${resendIn}s` : 'Non è arrivato? Invia di nuovo'}
            </button>
          </div>

          {/*
            * Si può rimandare, e va detto.
            *
            * L'account esiste già e il catalogo è visitabile: nascondere questa
            * via d'uscita farebbe sembrare la conferma un muro invece di un
            * passaggio, e chi non trova subito l'email chiuderebbe la scheda
            * invece di guardarsi intorno.
            */}
          <button
            type="button"
            onClick={close}
            className="btn-ghost mt-1 w-full rounded-lg py-2 text-xs text-ink-dim"
          >
            Lo faccio più tardi
          </button>
        </div>
      )}

      {view === 'sent' && (
        <div className="py-2 text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-success/10 ring-1 ring-success/20">
            <MailCheck className="h-6 w-6 text-success" aria-hidden="true" />
          </div>
          <p className="text-sm leading-relaxed text-ink">
            Se esiste un account con <strong className="font-semibold">{email}</strong>, riceverai un link per
            reimpostare la password.
          </p>
          <p className="mt-2 text-xs text-ink-dim">Il link scade dopo un'ora.</p>
          <button
            type="button"
            onClick={() => setView('login')}
            className="btn-secondary mt-6 w-full rounded-xl py-2.5 text-sm font-semibold"
          >
            Torna all'accesso
          </button>
        </div>
      )}

      {view === 'forgot' && (
        <form onSubmit={requestReset} noValidate className="space-y-5">
          <button
            type="button"
            onClick={() => { setView('login'); setError(''); }}
            className="btn-ghost -ml-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Indietro
          </button>
          <p className="text-sm leading-relaxed text-ink-muted">
            Inserisci l'indirizzo con cui ti sei registrato: ti invieremo un link per scegliere una nuova password.
          </p>
          <Field id="reset-email" label="Email" error={emailError}>
            <input
              id="reset-email"
              data-autofocus
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => markTouched('email')}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? 'reset-email-error' : undefined}
              placeholder="nome@esempio.com"
              className="input-field"
            />
          </Field>
          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="btn-primary flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Invia il link
          </button>
        </form>
      )}

      {isMode && (
        <>
          {/* Selettore scorrevole: l'indicatore si sposta, le etichette restano
              ferme. Un cambio di colore secco comunica il passaggio; uno che
              scorre comunica anche DA DOVE a dove. */}
          <div
            role="tablist"
            aria-label="Accedi o registrati"
            onKeyDown={onTabKeyDown}
            className="relative mb-6 flex rounded-xl border border-line bg-surface-sunken p-1"
          >
            <span
              aria-hidden="true"
              className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded bg-accent
                          transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                          ${view === 'register' ? 'translate-x-full' : 'translate-x-0'}`}
            />
            {TABS.map((tab) => (
              <button
                key={tab.key}
                ref={(el) => { tabRefs.current[tab.key] = el; }}
                type="button"
                role="tab"
                id={`auth-tab-${tab.key}`}
                aria-selected={view === tab.key}
                aria-controls={PANEL_ID}
                tabIndex={view === tab.key ? 0 : -1}
                onClick={() => selectTab(tab.key)}
                className={`relative z-10 flex-1 rounded-xl py-2.5 text-sm font-semibold transition-colors duration-200 ${
                  view === tab.key ? 'text-white' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={PANEL_ID} aria-labelledby={`auth-tab-${view}`}>
            <form onSubmit={view === 'login' ? login : register} noValidate className="space-y-5">
              <Field id="auth-email" label="Email" error={emailError}>
                <input
                  id="auth-email"
                  data-autofocus
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => markTouched('email')}
                  aria-invalid={emailError ? true : undefined}
                  aria-describedby={emailError ? 'auth-email-error' : undefined}
                  placeholder="nome@esempio.com"
                  className="input-field"
                />
              </Field>

              {view === 'register' && (
                <Field
                  id="auth-username"
                  label="Nome utente"
                  hint="Lettere, numeri e underscore. Da 3 a 30 caratteri."
                  error={usernameError}
                >
                  <input
                    id="auth-username"
                    type="text"
                    required
                    minLength={3}
                    maxLength={30}
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onBlur={() => markTouched('username')}
                    aria-invalid={usernameError ? true : undefined}
                    aria-describedby={usernameError ? 'auth-username-error' : 'auth-username-hint'}
                    placeholder="mario_rossi"
                    className="input-field"
                  />
                </Field>
              )}

              <Field
                id="auth-password"
                label="Password"
                action={
                  view === 'login' ? (
                    <button
                      type="button"
                      onClick={() => { setView('forgot'); setError(''); }}
                      className="text-xs font-medium text-accent-glow transition-colors hover:text-ink"
                    >
                      Password dimenticata?
                    </button>
                  ) : undefined
                }
              >
                <div className="relative">
                  <input
                    id="auth-password"
                    ref={passwordRef}
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete={view === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => markTouched('password')}
                    aria-describedby={view === 'register' ? RULES_ID : undefined}
                    placeholder="••••••••"
                    className="input-field pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setShowPassword((v) => !v);
                      // Il fuoco torna al campo: cambiare la visibilità è un
                      // gesto di supporto alla scrittura, non un modo di
                      // uscirne. Senza, si riprende a digitare nel vuoto.
                      passwordRef.current?.focus();
                    }}
                    aria-label={showPassword ? 'Nascondi password' : 'Mostra password'}
                    className="btn-ghost absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </Field>

              {view === 'register' && (
                <>
                  {/* Requisiti della password: si aggiornano a ogni carattere e
                      sono in una regione «status», così chi non vede lo schermo
                      riceve lo stesso riscontro immediato di chi lo vede. */}
                  <div
                    id={RULES_ID}
                    role="status"
                    aria-live="polite"
                    aria-label="Requisiti della password"
                    className="rounded-xl border border-line bg-surface-sunken p-4"
                  >
                    <div className="mb-3 flex items-center gap-1.5" aria-hidden="true">
                      {rules.map((rule, i) => (
                        <span
                          key={rule.label}
                          className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                            i < passwordScore
                              ? passwordScore === rules.length
                                ? 'bg-success'
                                : 'bg-warning'
                              : 'bg-line-strong'
                          }`}
                        />
                      ))}
                    </div>
                    <ul className="space-y-2">
                      {rules.map((rule) => (
                        <li
                          key={rule.label}
                          data-ok={rule.ok ? 'true' : 'false'}
                          className={`flex items-center gap-2.5 text-xs transition-colors duration-200 ${
                            rule.ok ? 'font-medium text-success' : 'text-ink-dim'
                          }`}
                        >
                          <span
                            className={`grid h-4 w-4 shrink-0 place-items-center rounded-full transition-colors duration-200 ${
                              rule.ok ? 'bg-success/15' : 'bg-line'
                            }`}
                          >
                            {rule.ok && <Check className="h-2.5 w-2.5" aria-hidden="true" />}
                          </span>
                          <span>{rule.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <fieldset>
                    <legend className="mb-2 text-sm font-semibold leading-none text-ink">
                      Data di nascita
                    </legend>
                    <p className="mb-3 text-xs font-normal leading-relaxed text-ink-dim">
                      Serve a verificare che tu sia maggiorenne. Non è mai visibile agli altri.
                    </p>
                    <div className="grid grid-cols-3 gap-2.5">
                      <Select label="Giorno" value={day} onChange={setDay} invalid={underage || undefined}>
                        <option value="">Giorno</option>
                        {/* L'elenco segue il mese: niente 31 febbraio. */}
                        {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </Select>
                      <Select label="Mese" value={month} onChange={setMonth} invalid={underage || undefined}>
                        <option value="">Mese</option>
                        {MONTHS.map((m, i) => (
                          <option key={m} value={i}>{m}</option>
                        ))}
                      </Select>
                      <Select label="Anno" value={year} onChange={setYear} invalid={underage || undefined}>
                        <option value="">Anno</option>
                        {YEARS.map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </Select>
                    </div>
                    {birthdateError && (
                      <p className="mt-2 flex items-start gap-1.5 text-xs font-medium leading-relaxed text-danger">
                        <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {birthdateError}
                      </p>
                    )}
                  </fieldset>

                  {/* Beta su invito. Il campo compare solo se il server dichiara
                      di richiederlo: altrimenti sarebbe un ostacolo senza scopo. */}
                  {inviteRequired && (
                    <Field
                      id="invite-code"
                      label="Codice d'invito"
                      hint="L'accesso è su invito durante la beta. Se ne hai ricevuto uno, incollalo qui."
                    >
                      <input
                        id="invite-code"
                        type="text"
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        aria-describedby="invite-code-hint"
                        placeholder="es. AMICI-2026"
                        className="input-field font-mono tracking-wide"
                      />
                    </Field>
                  )}
                </>
              )}

              <button
                type="submit"
                disabled={loading}
                aria-busy={loading}
                className="btn-primary flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {view === 'login' ? 'Accedi' : 'Crea account'}
              </button>
            </form>
          </div>

          {/* I pulsanti "Continua con Google/Apple" sono stati rimossi: non
              erano collegati ad alcun provider e portavano semplicemente al
              modulo email. Torneranno quando ci saranno le credenziali OAuth. */}

          <p className="mt-6 border-t border-line pt-5 text-center text-xs leading-relaxed text-ink-dim">
            Continuando accetti i{' '}
            <a href="/terms" target="_blank" rel="noreferrer" className="font-medium text-ink-muted underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink">
              termini
            </a>
            {' '}e l'
            <a href="/privacy" target="_blank" rel="noreferrer" className="font-medium text-ink-muted underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink">
              informativa privacy
            </a>.
          </p>
        </>
      )}
    </Modal>
  );
}
