import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Circle, Eye, EyeOff, Loader2, KeyRound } from 'lucide-react';
import api from '../services/api';
import { useStore } from '../store/useStore';
import { EmptyState } from '../components/ui/States';

/** Destinazione del link inviato per email. */
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const notify = useStore((s) => s.notify);
  const setAuthModalOpen = useStore((s) => s.setAuthModalOpen);

  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const rules = [
    { ok: password.length >= 8, label: 'Almeno 8 caratteri' },
    { ok: /[A-Z]/.test(password), label: 'Una lettera maiuscola' },
    { ok: /[0-9]/.test(password), label: 'Un numero' }
  ];

  if (!token) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <EmptyState
          icon={<KeyRound className="h-7 w-7" />}
          title="Link non valido"
          description="Manca il codice di verifica. Richiedi un nuovo link di recupero."
          action={<Link to="/" className="btn-secondary rounded-xl px-4 py-2 text-sm">Torna alla home</Link>}
        />
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!rules.every((r) => r.ok)) {
      setError('La password non rispetta i requisiti.');
      return;
    }

    setSaving(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      notify('Password aggiornata. Ora puoi accedere.', 'success');
      navigate('/');
      setAuthModalOpen(true, 'login');
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Impossibile reimpostare la password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <h1 className="mb-1 font-display text-2xl font-bold text-ink">Scegli una nuova password</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Al salvataggio tutte le sessioni aperte verranno chiuse.
      </p>

      {error && (
        <div role="alert" className="animate-shake mb-4 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-ink">Nuova password</label>
          <div className="relative">
            <input
              id="new-password"
              type={show ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field pr-11"
            />
            <button
              type="button"
              onClick={() => setShow(!show)}
              aria-label={show ? 'Nascondi password' : 'Mostra password'}
              className="btn-ghost absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5"
            >
              {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </div>

        <ul className="space-y-1 rounded-xl border border-line bg-surface p-3">
          {rules.map((rule) => (
            <li key={rule.label} className={`flex items-center gap-2 text-xs ${rule.ok ? 'text-success' : 'text-ink-dim'}`}>
              {rule.ok ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Circle className="h-3.5 w-3.5" aria-hidden="true" />}
              {rule.label}
            </li>
          ))}
        </ul>

        <button type="submit" disabled={saving} className="btn-primary flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm">
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Salva la nuova password
        </button>
      </form>
    </div>
  );
}
