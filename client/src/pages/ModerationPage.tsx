import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Clock3, Flag, Loader2, Check, X, ExternalLink } from 'lucide-react';
import api from '../services/api';
import { useStore } from '../store/useStore';
import { EmptyState, ErrorState, Spinner } from '../components/ui/States';
import Avatar from '../components/ui/Avatar';
import { relativeTime } from '../lib/format';

/**
 * Coda di moderazione (FASE D — S2-2, S2-13).
 *
 * Fino a qui le segnalazioni si accumulavano in una collezione che nessuna
 * interfaccia leggeva, e i personaggi si pubblicavano da soli. Un catalogo di
 * violazioni che nessuno può aprire non è moderazione.
 *
 * La pagina è raggiungibile solo con ruolo `moderator` o `admin`; il server
 * risponde comunque 404 a chiunque altro, quindi questo è un filtro di
 * comodità, non la difesa.
 */

interface PendingCharacter {
  _id: string;
  name: string;
  description: string;
  personality: string;
  backstory?: string;
  greetingMessage?: string;
  systemPrompt?: string;
  avatar: string;
  isNSFW: boolean;
  createdAt: string;
  createdBy?: { username: string; email: string } | null;
}

interface ReportRow {
  _id: string;
  source: 'user' | 'automatic';
  severity: string;
  targetType: 'character' | 'message' | 'user';
  targetId: string;
  reason: string;
  description: string;
  evidence: string;
  occurrences: number;
  status: string;
  createdAt: string;
  reporterId?: { username: string } | null;
  targetOwnerId?: { username: string; isBanned?: boolean } | null;
}

const REASON_LABELS: Record<string, string> = {
  hate_speech: 'Incitamento all’odio',
  harassment: 'Molestie',
  nsfw_unmarked: 'Contenuti per adulti non segnalati',
  copyright: 'Violazione di copyright',
  spam: 'Spam',
  other: 'Altro',
  sexual_minors: 'Contenuti sessuali su minori',
  sexual_violence: 'Violenza sessuale',
  violence_instructions: 'Istruzioni per armi o attacchi',
  self_harm_instructions: 'Istruzioni di autolesionismo',
  illegal_drugs: 'Produzione di sostanze illecite',
  prompt_injection: 'Tentativo di manipolazione del prompt'
};

export default function ModerationPage() {
  const { user, notify } = useStore();
  const [tab, setTab] = useState<'characters' | 'reports'>('characters');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [overview, setOverview] = useState<{ pendingReports: number; pendingCharacters: number } | null>(null);
  const [characters, setCharacters] = useState<PendingCharacter[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [working, setWorking] = useState<string | null>(null);

  const isStaff = user?.role === 'moderator' || user?.role === 'admin';

  const load = useCallback(async () => {
    if (!isStaff) return;
    setStatus('loading');
    try {
      const [ov, chars, reps] = await Promise.all([
        api.get('/admin/overview'),
        api.get('/admin/characters?status=pending'),
        api.get('/admin/reports?status=pending')
      ]);
      setOverview(ov.data);
      setCharacters(chars.data.characters);
      setReports(reps.data.reports);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [isStaff]);

  useEffect(() => { load(); }, [load]);

  if (!isStaff) {
    return (
      <EmptyState
        title="Pagina non disponibile"
        description="Questa sezione è riservata al team di moderazione."
        action={<Link to="/" className="btn-secondary rounded-xl px-4 py-2 text-sm">Torna a Scopri</Link>}
      />
    );
  }

  if (status === 'loading') return <Spinner label="Caricamento della coda…" />;
  if (status === 'error') return <ErrorState title="Impossibile caricare la coda di moderazione" onRetry={load} />;

  const decideCharacter = async (id: string, moderationStatus: 'approved' | 'rejected') => {
    let moderationReason = '';
    if (moderationStatus === 'rejected') {
      // Una decisione negativa deve poter essere spiegata a chi l'ha subita.
      moderationReason = window.prompt('Motivazione del rifiuto (verrà mostrata all’autore):') ?? '';
      if (!moderationReason.trim()) return;
    }

    setWorking(id);
    try {
      await api.patch(`/admin/characters/${id}`, { moderationStatus, moderationReason });
      setCharacters((prev) => prev.filter((c) => c._id !== id));
      notify(moderationStatus === 'approved' ? 'Personaggio approvato.' : 'Personaggio respinto.', 'success');
    } catch (err: any) {
      notify(err.response?.data?.error ?? 'Operazione non riuscita.', 'error');
    } finally {
      setWorking(null);
    }
  };

  const decideReport = async (id: string, next: 'actioned' | 'dismissed') => {
    setWorking(id);
    try {
      await api.patch(`/admin/reports/${id}`, { status: next });
      setReports((prev) => prev.filter((r) => r._id !== id));
      notify('Segnalazione aggiornata.', 'success');
    } catch {
      notify('Operazione non riuscita.', 'error');
    } finally {
      setWorking(null);
    }
  };

  const tabButton = (id: typeof tab, label: string, count: number) => (
    <button
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm transition-colors ${
        tab === id ? 'border-sapphire bg-sapphire-wash text-sapphire-glow' : 'border-line bg-surface text-ink-muted hover:border-line-strong'
      }`}
    >
      {label}
      <span className="rounded-md bg-bg px-1.5 py-0.5 font-mono text-[10px]">{count}</span>
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-8">
      <h1 className="mb-1 flex items-center gap-2 font-display text-2xl font-bold text-ink">
        <ShieldCheck className="h-5 w-5 text-sapphire-glow" aria-hidden="true" /> Moderazione
      </h1>
      <p className="mb-6 text-sm text-ink-muted">
        Personaggi in attesa di revisione e segnalazioni aperte, dalla più grave alla più recente.
      </p>

      <div className="mb-6 flex flex-wrap gap-2">
        {tabButton('characters', 'Personaggi', overview?.pendingCharacters ?? characters.length)}
        {tabButton('reports', 'Segnalazioni', overview?.pendingReports ?? reports.length)}
      </div>

      {tab === 'characters' && (
        characters.length === 0 ? (
          <EmptyState icon={<Check className="h-7 w-7" />} title="Nessun personaggio in attesa" description="La coda di revisione è vuota." />
        ) : (
          <ul className="space-y-4">
            {characters.map((c) => (
              <li key={c._id} className="rounded-2xl border border-line bg-surface p-5">
                <div className="flex items-start gap-4">
                  <Avatar src={c.avatar} name={c.name} size={56} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-base font-semibold text-ink">{c.name}</h2>
                      {c.isNSFW && <span className="rounded-md bg-danger/15 px-1.5 py-0.5 text-[10px] font-bold text-danger">18+</span>}
                      <span className="flex items-center gap-1 font-mono text-[10px] text-ink-dim">
                        <Clock3 className="h-3 w-3" aria-hidden="true" /> {relativeTime(c.createdAt)}
                      </span>
                    </div>
                    <p className="font-mono text-[10px] text-ink-dim">
                      di @{c.createdBy?.username ?? 'sconosciuto'}
                    </p>
                    <p className="mt-2 text-sm text-ink-muted">{c.description}</p>

                    {/* È il testo che decide il comportamento del personaggio:
                        è esattamente ciò che va letto prima di approvare. */}
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs text-sapphire-glow">Istruzioni del personaggio</summary>
                      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-bg p-3 font-mono text-[11px] text-ink-muted">
                        {c.systemPrompt || c.personality}
                      </pre>
                    </details>
                  </div>
                </div>

                <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
                  <button
                    onClick={() => decideCharacter(c._id, 'rejected')}
                    disabled={working === c._id}
                    className="flex items-center gap-1.5 rounded-xl border border-danger/50 px-4 py-2 text-sm text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
                  >
                    <X className="h-4 w-4" aria-hidden="true" /> Respingi
                  </button>
                  <button
                    onClick={() => decideCharacter(c._id, 'approved')}
                    disabled={working === c._id}
                    className="btn-primary flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm disabled:opacity-50"
                  >
                    {working === c._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                    Approva
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === 'reports' && (
        reports.length === 0 ? (
          <EmptyState icon={<Check className="h-7 w-7" />} title="Nessuna segnalazione aperta" description="Non c’è nulla da esaminare." />
        ) : (
          <ul className="space-y-4">
            {reports.map((r) => (
              <li key={r._id} className="rounded-2xl border border-line bg-surface p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                    r.source === 'automatic'
                      ? 'border border-warning/40 bg-warning/10 text-warning'
                      : 'border border-line bg-bg text-ink-muted'
                  }`}>
                    <Flag className="h-3 w-3" aria-hidden="true" />
                    {r.source === 'automatic' ? 'Automatica' : 'Segnalata da @' + (r.reporterId?.username ?? '—')}
                  </span>
                  <span className="text-sm font-semibold text-ink">{REASON_LABELS[r.reason] ?? r.reason}</span>
                  {r.occurrences > 1 && (
                    <span className="rounded-md bg-danger/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-danger">
                      ×{r.occurrences}
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-ink-dim">{relativeTime(r.createdAt)}</span>
                </div>

                <p className="mt-2 font-mono text-xs text-ink-dim">
                  {r.targetType === 'character' ? 'Personaggio' : r.targetType === 'message' ? 'Messaggio' : 'Utente'}
                  {r.targetOwnerId?.username ? ` · di @${r.targetOwnerId.username}` : ''}
                  {r.targetType === 'character' && (
                    <Link to={`/character/${r.targetId}`} className="ml-2 inline-flex items-center gap-1 text-sapphire-glow">
                      apri <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </Link>
                  )}
                </p>

                {r.description && <p className="mt-2 text-sm text-ink-muted">{r.description}</p>}

                {r.evidence && (
                  <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-bg p-3 font-mono text-[11px] text-ink-muted">
                    {r.evidence}
                  </pre>
                )}

                <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
                  <button
                    onClick={() => decideReport(r._id, 'dismissed')}
                    disabled={working === r._id}
                    className="btn-secondary rounded-xl px-4 py-2 text-sm disabled:opacity-50"
                  >
                    Archivia
                  </button>
                  <button
                    onClick={() => decideReport(r._id, 'actioned')}
                    disabled={working === r._id}
                    className="btn-primary flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm disabled:opacity-50"
                  >
                    {working === r._id && <Loader2 className="h-4 w-4 animate-spin" />}
                    Segna come gestita
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
