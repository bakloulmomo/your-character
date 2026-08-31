import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Globe, Lock, Loader2, ArrowLeft, ShieldCheck } from 'lucide-react';
import api from '../services/api';
import { useStore } from '../store/useStore';
import Avatar from '../components/ui/Avatar';
import { Spinner } from '../components/ui/States';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { errorMessage } from '../lib/apiError';

const CATEGORIES = [
  { value: 'assistant', label: 'Assistente' },
  { value: 'anime', label: 'Anime' },
  { value: 'gaming', label: 'Gaming' },
  { value: 'fantasy', label: 'Fantasy' },
  { value: 'historical', label: 'Storico' },
  { value: 'roleplay', label: 'Roleplay' },
  { value: 'custom', label: 'Altro' }
];

// Limiti allineati allo schema del server: prima il client non ne conosceva
// nessuno e l'utente scopriva i vincoli solo dopo l'invio (S3-26).
const LIMITS = {
  name: { min: 2, max: 60 },
  description: { min: 10, max: 500 },
  personality: { min: 20, max: 2000 },
  backstory: { max: 1500 },
  greetingMessage: { max: 300 }
};

const EMPTY = {
  name: '',
  description: '',
  personality: '',
  backstory: '',
  greetingMessage: 'Ciao! Di cosa vorresti parlare oggi?',
  avatar: '',
  tags: '',
  category: 'custom',
  // Privato per impostazione predefinita: prima "Pubblico" era preselezionato
  // e un click pubblicava in galleria senza revisione (S2-2).
  isPublic: false,
  isNSFW: false
};

export default function CreateCharacterPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editId = params.get('edit');

  useDocumentTitle(editId ? 'Modifica personaggio' : 'Crea un personaggio');
  const { user, setAuthModalOpen, notify } = useStore();

  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!editId);

  useEffect(() => {
    if (!editId) return;
    api
      .get(`/characters/${editId}`)
      .then((res) => {
        const c = res.data;
        setForm({
          name: c.name ?? '',
          description: c.description ?? '',
          personality: c.personality ?? '',
          backstory: c.backstory ?? '',
          greetingMessage: c.greetingMessage ?? '',
          avatar: c.avatar ?? '',
          tags: (c.tags ?? []).join(', '),
          category: c.category ?? 'custom',
          isPublic: !!c.isPublic,
          isNSFW: !!c.isNSFW
        });
      })
      .catch(() => notify('Impossibile caricare il personaggio da modificare.', 'error'))
      .finally(() => setLoading(false));
  }, [editId, notify]);

  if (!user) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <p className="mb-4 text-ink-muted">Accedi per creare un personaggio.</p>
        <button onClick={() => setAuthModalOpen(true, 'login')} className="btn-primary rounded-xl px-5 py-2.5 text-sm">
          Accedi
        </button>
      </div>
    );
  }

  if (loading) return <Spinner label="Caricamento…" />;

  const set = (key: keyof typeof EMPTY, value: string | boolean) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((e) => ({ ...e, [key]: '' }));
  };

  const validate = () => {
    const errors: Record<string, string> = {};
    if (form.name.trim().length < LIMITS.name.min) errors.name = `Almeno ${LIMITS.name.min} caratteri.`;
    if (form.description.trim().length < LIMITS.description.min) errors.description = `Almeno ${LIMITS.description.min} caratteri.`;
    if (form.personality.trim().length < LIMITS.personality.min) errors.personality = `Almeno ${LIMITS.personality.min} caratteri: è ciò che definisce come si comporta.`;
    if (form.avatar && !/^https?:\/\//i.test(form.avatar)) errors.avatar = 'Deve essere un indirizzo che inizia con http:// o https://';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError('');
    if (!validate()) return;

    setSaving(true);
    try {
      const payload = {
        ...form,
        avatar: form.avatar.trim() || `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(form.name)}`,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean)
      };

      const res = editId
        ? await api.put(`/characters/${editId}`, payload)
        : await api.post('/characters', payload);

      notify(editId ? 'Personaggio aggiornato.' : 'Personaggio creato.', 'success');
      navigate(`/character/${res.data._id}`);
    } catch (err: any) {
      // I dettagli campo per campo del server venivano scartati: l'utente
      // leggeva solo "Dati di input non validi".
      const details = err.response?.data?.details;
      if (Array.isArray(details)) {
        const mapped: Record<string, string> = {};
        details.forEach((d: { field: string; message: string }) => { mapped[d.field] = d.message; });
        setFieldErrors(mapped);
        setGeneralError('Controlla i campi segnalati.');
      } else {
        setGeneralError(errorMessage(err, 'Impossibile salvare il personaggio.'));
      }
    } finally {
      setSaving(false);
    }
  };

  const field = (
    key: keyof typeof EMPTY,
    label: string,
    hint: string,
    max: number,
    rows = 0
  ) => {
    const value = form[key] as string;
    const error = fieldErrors[key];
    const Tag = rows > 0 ? 'textarea' : 'input';

    return (
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <label htmlFor={key} className="text-sm font-medium text-ink">{label}</label>
          <span className={`text-micro ${value.length > max ? 'text-danger' : 'text-ink-dim'}`}>
            {value.length}/{max}
          </span>
        </div>
        <Tag
          id={key}
          rows={rows || undefined}
          value={value}
          maxLength={max}
          aria-invalid={!!error}
          aria-describedby={`${key}-hint`}
          onChange={(e: any) => set(key, e.target.value)}
          className={`input-field ${rows > 0 ? 'resize-y' : ''} ${error ? 'border-danger' : ''}`}
        />
        <p id={`${key}-hint`} className={`mt-1 text-xs ${error ? 'text-danger' : 'text-ink-dim'}`}>
          {error || hint}
        </p>
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-8">
      <button onClick={() => navigate(-1)} className="btn-ghost mb-5 flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Indietro
      </button>

      <h1 className="mb-1 font-display text-2xl font-bold text-ink">
        {editId ? 'Modifica personaggio' : 'Crea un personaggio'}
      </h1>
      <p className="mb-8 text-sm text-ink-muted">
        La personalità è la parte che conta: è ciò che il modello legge per sapere chi interpretare.
      </p>

      <form onSubmit={submit} className="space-y-6">
        {generalError && (
          <div role="alert" className="animate-shake rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            {generalError}
          </div>
        )}

        {/* Visibilità, con la differenza spiegata */}
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink">Visibilità</legend>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => set('isPublic', false)}
              aria-pressed={!form.isPublic}
              className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors ${
                !form.isPublic ? 'border-sapphire bg-sapphire-wash' : 'border-line bg-surface hover:border-line-strong'
              }`}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Privato
              </span>
              <span className="text-xs text-ink-muted">Solo tu puoi vederlo e conversarci.</span>
            </button>

            <button
              type="button"
              onClick={() => set('isPublic', true)}
              aria-pressed={form.isPublic}
              className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors ${
                form.isPublic ? 'border-sapphire bg-sapphire-wash' : 'border-line bg-surface hover:border-line-strong'
              }`}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                <Globe className="h-3.5 w-3.5" aria-hidden="true" /> Pubblico
              </span>
              <span className="text-xs text-ink-muted">Dopo una revisione, visibile a tutti in galleria.</span>
            </button>
          </div>

          {/* La revisione va detta PRIMA di pubblicare, non scoperta dopo
              chiedendosi perché il personaggio non compare (FASE D — S2-2). */}
          {form.isPublic && (
            <p className="mt-2 flex items-start gap-2 rounded-xl border border-line bg-surface p-3 text-xs text-ink-muted">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
              <span>
                I personaggi pubblici passano da una revisione prima di comparire in galleria. Nel
                frattempo resta visibile e utilizzabile solo da te, e lo ritrovi in «I miei
                personaggi». Anche le modifiche successive tornano in revisione.
              </span>
            </p>
          )}
        </fieldset>

        {field('name', 'Nome', 'Come si chiama il personaggio.', LIMITS.name.max)}
        {field('description', 'Descrizione breve', 'La riga che appare sulla card in galleria.', LIMITS.description.max, 2)}
        {field('personality', 'Personalità', 'Come parla, cosa sa, come si comporta. Più è specifica, più le risposte saranno coerenti.', LIMITS.personality.max, 5)}
        {/* Questi due campi esistevano nello stato del modale e non avevano
            alcun input: tutti i personaggi creati avevano lo stesso saluto (S3-25). */}
        {field('backstory', 'Storia (facoltativa)', 'Il passato del personaggio, se ne ha uno.', LIMITS.backstory.max, 3)}
        {field('greetingMessage', 'Messaggio di benvenuto', 'La prima cosa che dice quando si apre una conversazione.', LIMITS.greetingMessage.max, 2)}

        {/* Avatar con anteprima */}
        <div>
          <label htmlFor="avatar" className="mb-1.5 block text-sm font-medium text-ink">Immagine</label>
          <div className="flex items-center gap-3">
            <Avatar src={form.avatar} name={form.name || '?'} size={56} />
            <input
              id="avatar"
              type="url"
              value={form.avatar}
              onChange={(e) => set('avatar', e.target.value)}
              placeholder="https://…"
              aria-invalid={!!fieldErrors.avatar}
              className={`input-field flex-1 ${fieldErrors.avatar ? 'border-danger' : ''}`}
            />
          </div>
          <p className={`mt-1 text-xs ${fieldErrors.avatar ? 'text-danger' : 'text-ink-dim'}`}>
            {fieldErrors.avatar || 'Lascia vuoto per generare un avatar dalle iniziali.'}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="category" className="mb-1.5 block text-sm font-medium text-ink">Categoria</label>
            <select id="category" value={form.category} onChange={(e) => set('category', e.target.value)} className="input-field">
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="tags" className="mb-1.5 block text-sm font-medium text-ink">Tag</label>
            <input
              id="tags"
              value={form.tags}
              onChange={(e) => set('tags', e.target.value)}
              placeholder="fantasy, mentore, magia"
              className="input-field"
            />
            <p className="mt-1 text-xs text-ink-dim">Separati da virgola. Aiutano a farlo trovare.</p>
          </div>
        </div>

        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={form.isNSFW}
            onChange={(e) => set('isNSFW', e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-line bg-surface accent-sapphire"
          />
          <span>
            <span className="block text-sm text-ink">Contenuti per adulti</span>
            <span className="block text-xs text-ink-dim">
              Verrà mostrato solo a utenti maggiorenni che hanno attivato i contenuti per adulti
              nelle impostazioni. Per contrassegnarlo così devi essere maggiorenne.
            </span>
          </span>
        </label>

        <div className="flex justify-end gap-2 border-t border-line pt-5">
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary rounded-xl px-4 py-2.5 text-sm">
            Annulla
          </button>
          <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm">
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {editId ? 'Salva modifiche' : form.isPublic ? 'Pubblica' : 'Salva privato'}
          </button>
        </div>
      </form>
    </div>
  );
}
