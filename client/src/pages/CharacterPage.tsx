import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  MessageSquare, ShieldAlert, Share2, Pencil, Trash2, ArrowLeft, Plus, Loader2, UserX, EyeOff, Clock3
} from 'lucide-react';
import api from '../services/api';
import { useCharacter } from '../hooks/useCharacters';
import { useChats } from '../hooks/useChats';
import { useStore, normalizeChat } from '../store/useStore';
import Avatar from '../components/ui/Avatar';
import { EmptyState, ErrorState, Spinner } from '../components/ui/States';
import { formatCount, relativeTime } from '../lib/format';

/**
 * Scheda del personaggio — la pagina che mancava.
 *
 * Prima il click su una card creava immediatamente una chat persistente: ogni
 * click accidentale lasciava una conversazione vuota e non c'era modo di
 * riprenderne una esistente (S3-6, S3-7).
 */
export default function CharacterPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { character, status } = useCharacter(id);
  const { chats, reload: reloadChats } = useChats();
  const { user, setAuthModalOpen, setReportModalOpen, notify, upsertChat } = useStore();
  const [starting, setStarting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (status === 'loading') return <Spinner label="Caricamento del personaggio…" />;

  if (status === 'notfound') {
    return (
      <EmptyState
        icon={<UserX className="h-7 w-7" />}
        title="Personaggio non trovato"
        description="Potrebbe essere stato eliminato, oppure è privato e appartiene a qualcun altro."
        action={<Link to="/" className="btn-secondary rounded-xl px-4 py-2 text-sm">Torna a Scopri</Link>}
      />
    );
  }

  // Contenuto per adulti non sbloccato: si dice che cosa serve per aprirlo,
  // invece di un «non trovato» che sembrerebbe un errore (S2-3).
  if (status === 'restricted') {
    return (
      <EmptyState
        icon={<EyeOff className="h-7 w-7" />}
        title="Contenuto per adulti"
        description="Per aprire questo personaggio devi essere maggiorenne e attivare i contenuti per adulti nelle impostazioni del tuo account."
        action={
          user ? (
            <Link to="/settings" className="btn-primary rounded-xl px-4 py-2 text-sm">Vai alle impostazioni</Link>
          ) : (
            <button onClick={() => setAuthModalOpen(true, 'login')} className="btn-primary rounded-xl px-4 py-2 text-sm">
              Accedi
            </button>
          )
        }
      />
    );
  }

  if (status === 'error' || !character) {
    return <ErrorState title="Impossibile caricare il personaggio" onRetry={() => navigate(0)} />;
  }

  const creator = typeof character.createdBy === 'object' ? character.createdBy : null;
  const isOwner = !!user && !!creator?._id && creator._id === user.id;
  const existingChats = chats.filter((c) => c.character?._id === character._id);

  const startChat = async () => {
    if (!user) {
      setAuthModalOpen(true, 'login');
      return;
    }
    setStarting(true);
    try {
      const res = await api.post('/chats', { characterId: character._id });
      const chat = normalizeChat(res.data, character);
      upsertChat(chat);
      navigate(`/chat/${chat._id}`);
    } catch (err: any) {
      notify(err.response?.data?.error ?? 'Impossibile aprire la conversazione.', 'error');
      setStarting(false);
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/character/${character._id}`;
    try {
      await navigator.clipboard.writeText(url);
      notify('Link copiato negli appunti.', 'success');
    } catch {
      notify(url, 'info');
    }
  };

  const remove = async () => {
    try {
      const res = await api.delete(`/characters/${character._id}`);
      const removed = res.data?.deletedChats ?? 0;
      notify(
        removed > 0
          ? `Personaggio eliminato, insieme a ${removed} ${removed === 1 ? 'conversazione' : 'conversazioni'}.`
          : 'Personaggio eliminato.',
        'success'
      );
      reloadChats();
      navigate('/profile');
    } catch {
      notify('Impossibile eliminare il personaggio.', 'error');
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-8">
      <button onClick={() => navigate(-1)} className="btn-ghost mb-6 flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Indietro
      </button>

      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-start">
        <Avatar src={character.avatar} name={character.name} size={112} rounded="2xl" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-bold text-ink">{character.name}</h1>
            {character.isNSFW && (
              <span className="rounded-md bg-danger/15 px-2 py-0.5 text-[10px] font-bold text-danger">18+</span>
            )}
            {!character.isPublic && (
              <span className="rounded-md bg-surface px-2 py-0.5 text-[10px] font-medium text-ink-muted">Privato</span>
            )}
            {character.isPublic && character.moderationStatus === 'pending' && (
              <span className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                <Clock3 className="h-3 w-3" aria-hidden="true" /> In revisione
              </span>
            )}
            {character.isPublic && character.moderationStatus === 'rejected' && (
              <span className="rounded-md border border-danger/40 bg-danger/10 px-2 py-0.5 text-[10px] font-medium text-danger">
                Respinto
              </span>
            )}
          </div>

          {/* La decisione della moderazione va comunicata all'autore, con la
              sua motivazione: un personaggio che sparisce senza spiegazione è
              indistinguibile da un guasto. */}
          {isOwner && character.isPublic && character.moderationStatus === 'pending' && (
            <p className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-ink-muted">
              In attesa di revisione: per ora lo vedi solo tu. Comparirà in galleria una volta approvato.
            </p>
          )}
          {isOwner && character.moderationStatus === 'rejected' && (
            <p className="mt-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-ink-muted">
              <strong className="text-danger">Non approvato.</strong>{' '}
              {character.moderationReason || 'Nessuna motivazione registrata.'} Puoi modificarlo e
              rimandarlo in revisione.
            </p>
          )}

          <p className="mt-0.5 font-mono text-xs text-ink-dim">
            di @{creator?.username ?? 'community'}
          </p>

          <p className="mt-3 text-sm leading-relaxed text-ink-muted">{character.description}</p>

          <div className="mt-4 flex items-center gap-4 font-mono text-xs text-ink-dim">
            <span className="flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
              {formatCount(character.chatCount ?? character.usageCount)} conversazioni
            </span>
          </div>

          {character.tags?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {character.tags.map((tag) => (
                <span key={tag} className="rounded-md bg-sapphire-wash px-2 py-0.5 text-[10px] font-medium text-sapphire-glow">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Azione principale */}
      <div className="mb-8 flex flex-wrap items-center gap-2">
        <button onClick={startChat} disabled={starting} className="btn-primary flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm">
          {starting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
          Nuova conversazione
        </button>

        <button onClick={share} className="btn-secondary flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm">
          <Share2 className="h-4 w-4" aria-hidden="true" /> Condividi
        </button>

        <button
          onClick={() => setReportModalOpen(true, { type: 'character', id: character._id })}
          className="btn-secondary flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm"
        >
          <ShieldAlert className="h-4 w-4" aria-hidden="true" /> Segnala
        </button>

        {isOwner && (
          <>
            <Link to={`/create?edit=${character._id}`} className="btn-secondary flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm">
              <Pencil className="h-4 w-4" aria-hidden="true" /> Modifica
            </Link>
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 rounded-xl border border-danger/40 px-4 py-2.5 text-sm text-danger transition-colors hover:bg-danger/10"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Elimina
            </button>
          </>
        )}
      </div>

      {/* Conversazioni già aperte con questo personaggio */}
      {existingChats.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 font-display text-base font-semibold text-ink">Riprendi dove eri</h2>
          <ul className="space-y-2">
            {existingChats.map((chat) => (
              <li key={chat._id}>
                <Link
                  to={`/chat/${chat._id}`}
                  className="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-sapphire/60 hover:bg-surface-hover"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink">{chat.title}</span>
                    <span className="block text-xs text-ink-dim">
                      {chat.messageCount} messaggi · {relativeTime(chat.lastMessageAt)}
                    </span>
                  </span>
                  <MessageSquare className="h-4 w-4 shrink-0 text-ink-dim" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {character.greetingMessage && (
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-dim">Come ti accoglie</h2>
          <p className="text-sm italic leading-relaxed text-ink-muted">«{character.greetingMessage}»</p>
        </section>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setConfirmDelete(false)}>
          <div role="dialog" aria-modal="true" aria-label="Conferma eliminazione" onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-line bg-bg-elevated p-5">
            <h2 className="font-display text-base font-semibold text-ink">Eliminare {character.name}?</h2>
            <p className="mt-2 text-sm text-ink-muted">
              Verranno eliminate anche tutte le conversazioni collegate. L'operazione non è reversibile.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(false)} className="btn-secondary rounded-xl px-4 py-2 text-sm">Annulla</button>
              <button onClick={remove} className="rounded-xl bg-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-danger/85">
                Elimina definitivamente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
