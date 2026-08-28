import { useEffect, useState } from 'react';
import { Eye, EyeOff, CheckCircle2, Circle, Loader2, ArrowLeft, MailCheck } from 'lucide-react';
import api from '../services/api';
import { useStore } from '../store/useStore';
import Modal from './ui/Modal';

type View = 'login' | 'register' | 'forgot' | 'sent';

const MONTHS = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
];

const currentYear = new Date().getUTCFullYear();
const YEARS = Array.from({ length: 100 }, (_, i) => currentYear - 18 - i);

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

  useEffect(() => {
    if (isAuthModalOpen) {
      setView(authModalMode);
      setError('');
      setLoading(false);
    }
  }, [isAuthModalOpen, authModalMode]);

  const close = () => {
    setAuthModalOpen(false);
    setPassword('');
    setError('');
  };

  const rules = [
    { ok: password.length >= 8, label: 'Almeno 8 caratteri' },
    { ok: /[A-Z]/.test(password), label: 'Una lettera maiuscola' },
    { ok: /[0-9]/.test(password), label: 'Un numero' }
  ];

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      setToken(res.data.token);
      setUser(res.data.user);
      notify(`Bentornato, @${res.data.user.username}.`, 'success');
      close();
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Accesso non riuscito.');
    } finally {
      setLoading(false);
    }
  };

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!rules.every((r) => r.ok)) {
      setError('La password non rispetta i requisiti.');
      return;
    }
    if (!day || !month || !year) {
      setError('Inserisci la tua data di nascita.');
      return;
    }

    // Verifica dell'età anche qui, oltre che sul server: l'app ospita
    // contenuti per adulti e la data va controllata prima dell'invio.
    const birthdate = new Date(Date.UTC(Number(year), Number(month), Number(day)));
    if (birthdate.getUTCDate() !== Number(day) || birthdate.getUTCMonth() !== Number(month)) {
      setError('Data di nascita non valida.');
      return;
    }
    const age = (Date.now() - birthdate.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (age < 18) {
      setError('Devi avere almeno 18 anni per registrarti.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.post('/auth/register', {
        email,
        username,
        password,
        birthdate: `${year}-${String(Number(month) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        // Inviato solo quando serve: il server ignora il campo se la beta e' aperta.
        ...(inviteRequired ? { inviteCode } : {})
      });
      setToken(res.data.token);
      setUser(res.data.user);
      notify('Account creato. Hai 10 crediti per cominciare.', 'success');
      close();
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Registrazione non riuscita.');
    } finally {
      setLoading(false);
    }
  };

  const requestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setView('sent');
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Richiesta non riuscita.');
    } finally {
      setLoading(false);
    }
  };

  const titles: Record<View, string> = {
    login: 'Accedi',
    register: 'Crea un account',
    forgot: 'Recupera la password',
    sent: 'Controlla la posta'
  };

  return (
    <Modal open={isAuthModalOpen} onClose={close} title={titles[view]}>
      {error && (
        <div role="alert" className="animate-shake mb-4 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {view === 'sent' && (
        <div className="py-4 text-center">
          <MailCheck className="mx-auto mb-3 h-10 w-10 text-success" aria-hidden="true" />
          <p className="text-sm text-ink">
            Se esiste un account con <strong>{email}</strong>, riceverai un link per reimpostare la password.
          </p>
          <p className="mt-2 text-xs text-ink-dim">Il link scade dopo un'ora.</p>
          <button onClick={() => setView('login')} className="btn-secondary mt-5 rounded-xl px-4 py-2 text-sm">
            Torna all'accesso
          </button>
        </div>
      )}

      {view === 'forgot' && (
        <form onSubmit={requestReset} className="space-y-4">
          <button type="button" onClick={() => setView('login')} className="btn-ghost -ml-1 flex items-center gap-1 rounded-lg px-2 py-1 text-xs">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Indietro
          </button>
          <p className="text-sm text-ink-muted">
            Inserisci l'indirizzo con cui ti sei registrato: ti invieremo un link per scegliere una nuova password.
          </p>
          <div>
            <label htmlFor="reset-email" className="mb-1.5 block text-sm font-medium text-ink">Email</label>
            <input
              id="reset-email" type="email" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="nome@esempio.com" className="input-field"
            />
          </div>
          <button type="submit" disabled={loading} className="btn-primary flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm">
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Invia il link
          </button>
        </form>
      )}

      {(view === 'login' || view === 'register') && (
        <>
          <div className="mb-5 flex rounded-xl border border-line bg-surface p-1" role="tablist">
            {(['login', 'register'] as const).map((mode) => (
              <button
                key={mode}
                role="tab"
                aria-selected={view === mode}
                onClick={() => { setView(mode); setError(''); }}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                  view === mode ? 'bg-sapphire text-white' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {mode === 'login' ? 'Accedi' : 'Registrati'}
              </button>
            ))}
          </div>

          <form onSubmit={view === 'login' ? login : register} className="space-y-4">
            <div>
              <label htmlFor="auth-email" className="mb-1.5 block text-sm font-medium text-ink">Email</label>
              <input
                id="auth-email" type="email" required autoComplete="email"
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@esempio.com" className="input-field"
              />
            </div>

            {view === 'register' && (
              <div>
                <label htmlFor="auth-username" className="mb-1.5 block text-sm font-medium text-ink">Nome utente</label>
                <input
                  id="auth-username" type="text" required autoComplete="username"
                  minLength={3} maxLength={30} pattern="[a-zA-Z0-9_]+"
                  value={username} onChange={(e) => setUsername(e.target.value)}
                  placeholder="mario_rossi" className="input-field"
                />
                <p className="mt-1 text-xs text-ink-dim">Lettere, numeri e underscore. Da 3 a 30 caratteri.</p>
              </div>
            )}

            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <label htmlFor="auth-password" className="text-sm font-medium text-ink">Password</label>
                {view === 'login' && (
                  <button type="button" onClick={() => { setView('forgot'); setError(''); }} className="text-xs text-sapphire-glow hover:underline">
                    Password dimenticata?
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete={view === 'login' ? 'current-password' : 'new-password'}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••" className="input-field pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Nascondi password' : 'Mostra password'}
                  className="btn-ghost absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                </button>
              </div>
            </div>

            {view === 'register' && (
              <>
                <ul className="space-y-1 rounded-xl border border-line bg-surface p-3">
                  {rules.map((rule) => (
                    <li key={rule.label} className={`flex items-center gap-2 text-xs ${rule.ok ? 'text-success' : 'text-ink-dim'}`}>
                      {rule.ok ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Circle className="h-3.5 w-3.5" aria-hidden="true" />}
                      {rule.label}
                    </li>
                  ))}
                </ul>

                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium text-ink">Data di nascita</legend>
                  <p className="mb-2 text-xs text-ink-dim">
                    Serve a verificare che tu sia maggiorenne. Non è mai visibile agli altri.
                  </p>
                  {/* Selettori nativi al posto di tre campi di testo liberi. */}
                  <div className="grid grid-cols-3 gap-2">
                    <select aria-label="Giorno" value={day} onChange={(e) => setDay(e.target.value)} required className="input-field">
                      <option value="">Giorno</option>
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                    <select aria-label="Mese" value={month} onChange={(e) => setMonth(e.target.value)} required className="input-field">
                      <option value="">Mese</option>
                      {MONTHS.map((m, i) => (
                        <option key={m} value={i}>{m}</option>
                      ))}
                    </select>
                    <select aria-label="Anno" value={year} onChange={(e) => setYear(e.target.value)} required className="input-field">
                      <option value="">Anno</option>
                      {YEARS.map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                </fieldset>

                {/* Beta su invito. Il campo compare solo se il server dichiara
                    di richiederlo: altrimenti sarebbe un ostacolo senza scopo. */}
                {inviteRequired && (
                  <div>
                    <label htmlFor="invite-code" className="mb-1.5 block text-sm font-medium text-ink">
                      Codice d'invito
                    </label>
                    <p className="mb-2 text-xs text-ink-dim">
                      L'accesso è su invito durante la beta. Se ne hai ricevuto uno, incollalo qui.
                    </p>
                    <input
                      id="invite-code"
                      type="text"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      required
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="es. AMICI-2026"
                      className="input-field font-mono"
                    />
                  </div>
                )}
              </>
            )}

            <button type="submit" disabled={loading} className="btn-primary flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm">
              {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {view === 'login' ? 'Accedi' : 'Crea account'}
            </button>
          </form>

          {/* I pulsanti "Continua con Google/Apple" sono stati rimossi: non
              erano collegati ad alcun provider e portavano semplicemente al
              modulo email. Torneranno quando ci saranno le credenziali OAuth. */}

          <p className="mt-5 text-center text-xs text-ink-dim">
            Continuando accetti i{' '}
            <a href="/terms" target="_blank" rel="noreferrer" className="text-ink-muted underline hover:text-ink">termini</a>
            {' '}e l'
            <a href="/privacy" target="_blank" rel="noreferrer" className="text-ink-muted underline hover:text-ink">informativa privacy</a>.
          </p>
        </>
      )}
    </Modal>
  );
}
