import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock3, Flag, Loader2, Check, X, ExternalLink } from 'lucide-react';
import api from '../services/api';
import { useStore } from '../store/useStore';
import { EmptyState, ErrorState, Spinner } from '../components/ui/States';
import Avatar from '../components/ui/Avatar';
import Modal from '../components/ui/Modal';
import { relativeTime } from '../lib/format';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { errorMessage } from '../lib/apiError';
import { Button } from '../components/ui/Button';
import { PageContainer, PageHeader } from '../components/ui/Page';

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
  useDocumentTitle('Moderazione');
  const { user, notify } = useStore();
  const [tab, setTab] = useState<'characters' | 'reports'>('characters');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [overview, setOverview] = useState<{ pendingReports: number; pendingCharacters: number } | null>(null);
  const [characters, setCharacters] = useState<PendingCharacter[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  /**
   * Personaggio per cui si sta scrivendo una motivazione di rifiuto.
   *
   * Prima la motivazione si chiedeva con `window.prompt()`: una finestra di
   * sistema, senza stile, senza limite di lunghezza, senza modo di annullare
   * distinguendo «ho cambiato idea» da «non ho scritto niente» — e in alcuni
   * contesti bloccata dal browser, nel qual caso la decisione negativa
   * semplicemente non si poteva prendere. È lo stesso difetto già corretto
   * quando l'esportazione dei dati usava `alert()`.
   */
  const [rejecting, setRejecting] = useState<PendingCharacter | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const isStaff = user?.role === 'moderator' || user?.role === 'admin';

  const load = useCallback(async () => {
    if (!isStaff) return;
    setStatus('loading');
    try {
      const [ov, chars, reps] = await Promise.all([
        api.get('/admin/overview'),
        api.get('/admin/characters?status=da_rivedere'),
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
        action={<Link to="/discover" className="btn-secondary rounded-xl px-4 py-2 text-sm">Torna a Scopri</Link>}
      />
    );
  }

  if (status === 'loading') return <Spinner label="Caricamento della coda…" />;
  if (status === 'error') return <ErrorState title="Impossibile caricare la coda di moderazione" onRetry={load} />;

  const decideCharacter = async (
    id: string,
    moderationStatus: 'approved' | 'rejected',
    moderationReason = ''
  ) => {
    setWorking(id);
    try {
      await api.patch(`/admin/characters/${id}`, { moderationStatus, moderationReason });
      setCharacters((prev) => prev.filter((c) => c._id !== id));
      setRejecting(null);
      setRejectReason('');
      notify(moderationStatus === 'approved' ? 'Personaggio approvato.' : 'Personaggio respinto.', 'success');
    } catch (err: any) {
      notify(errorMessage(err, 'Operazione non riuscita.'), 'error');
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
        tab === id ? 'border-ink text-ink' : 'border-line text-ink-muted hover:border-line-control hover:text-ink'
      }`}
    >
      {label}
      <span className="rounded-lg bg-bg px-1.5 py-0.5 text-micro">{count}</span>
    </button>
  );

  return (
    <PageContainer width="prose">
      <PageHeader
        eyebrow="Strumenti interni"
        title="Moderazione"
        description="Personaggi già pubblicati che nessuno ha ancora esaminato, e segnalazioni aperte dalla più grave alla più recente."
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {tabButton('characters', 'Personaggi', overview?.pendingCharacters ?? characters.length)}
        {tabButton('reports', 'Segnalazioni', overview?.pendingReports ?? reports.length)}
      </div>

      {tab === 'characters' && (
        characters.length === 0 ? (
          <EmptyState icon={<Check className="h-7 w-7" />} title="Nessun personaggio da esaminare" description="Tutto ciò che è stato pubblicato è già passato sotto gli occhi di qualcuno." />
        ) : (
          <ul className="space-y-4">
            {characters.map((c) => (
              <li key={c._id} className="rounded-xl border border-line bg-surface p-5">
                <div className="flex items-start gap-4">
                  <Avatar src={c.avatar} name={c.name} size={56} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-base font-semibold text-ink">{c.name}</h2>
                      {c.isNSFW && <span className="rounded-lg bg-danger/15 px-1.5 py-0.5 text-micro font-bold text-danger">18+</span>}
                      <span className="flex items-center gap-1 text-micro text-ink-dim">
                        <Clock3 className="h-3 w-3" aria-hidden="true" /> {relativeTime(c.createdAt)}
                      </span>
                    </div>
                    <p className="text-micro text-ink-dim">
                      di @{c.createdBy?.username ?? 'sconosciuto'}
                    </p>
                    <p className="mt-2 text-sm text-ink-muted">{c.description}</p>

                    {/* È il testo che decide il comportamento del personaggio:
                        è esattamente ciò che va letto prima di approvare. */}
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs text-accent-glow">Istruzioni del personaggio</summary>
                      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-bg p-3 font-mono text-xs text-ink-muted">
                        {c.systemPrompt || c.personality}
                      </pre>
                    </details>
                  </div>
                </div>

                <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
                  <button
                    onClick={() => { setRejecting(c); setRejectReason(''); }}
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
              <li key={r._id} className="rounded-xl border border-line bg-surface p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-micro font-medium ${
                    r.source === 'automatic'
                      ? 'border border-warning/40 bg-warning/10 text-warning'
                      : 'border border-line bg-bg text-ink-muted'
                  }`}>
                    <Flag className="h-3 w-3" aria-hidden="true" />
                    {r.source === 'automatic' ? 'Automatica' : 'Segnalata da @' + (r.reporterId?.username ?? '—')}
                  </span>
                  <span className="text-sm font-semibold text-ink">{REASON_LABELS[r.reason] ?? r.reason}</span>
                  {r.occurrences > 1 && (
                    <span className="rounded-lg bg-danger/15 px-1.5 py-0.5 text-micro font-bold text-danger">
                      ×{r.occurrences}
                    </span>
                  )}
                  <span className="text-micro text-ink-dim">{relativeTime(r.createdAt)}</span>
                </div>

                <p className="mt-2 text-xs text-ink-dim">
                  {r.targetType === 'character' ? 'Personaggio' : r.targetType === 'message' ? 'Messaggio' : 'Utente'}
                  {r.targetOwnerId?.username ? ` · di @${r.targetOwnerId.username}` : ''}
                  {r.targetType === 'character' && (
                    <Link to={`/character/${r.targetId}`} className="ml-2 inline-flex items-center gap-1 text-accent-glow">
                      apri <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </Link>
                  )}
                </p>

                {r.description && <p className="mt-2 text-sm text-ink-muted">{r.description}</p>}

                {r.evidence && (
                  <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-bg p-3 font-mono text-xs text-ink-muted">
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

      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title={rejecting ? `Respingere ${rejecting.name}?` : 'Respingere'}
      >
        <p className="mb-3 text-sm text-ink-muted">
          La motivazione viene mostrata all'autore sulla scheda del personaggio. È l'unica cosa che
          gli spiega perché non è comparso in galleria: una decisione senza motivazione è
          indistinguibile da un guasto.
        </p>
        <label htmlFor="reject-reason" className="mb-1.5 block text-sm font-medium text-ink">
          Motivazione
        </label>
        <textarea
          id="reject-reason"
          rows={4}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          maxLength={500}
          placeholder="Es. la descrizione riprende un personaggio protetto da copyright."
          className="input-field resize-y"
        />
        <p className="mt-1 text-right text-micro text-ink-dim">{rejectReason.length}/500</p>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setRejecting(null)} className="btn-secondary rounded-xl px-4 py-2 text-sm">
            Annulla
          </button>
          <Button
            variant="danger-strong"
            onClick={() => rejecting && decideCharacter(rejecting._id, 'rejected', rejectReason.trim())}
            disabled={!rejectReason.trim()}
            loading={working === rejecting?._id}
          >
            Respingi
          </Button>
        </div>
      </Modal>
    </PageContainer>
  );
}
