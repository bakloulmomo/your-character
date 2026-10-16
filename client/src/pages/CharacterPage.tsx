import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  MessageSquare, ShieldAlert, Share2, Pencil, Trash2, ArrowLeft, Plus, Loader2, UserX, EyeOff
} from 'lucide-react';
import api from '../services/api';
import { useCharacter } from '../hooks/useCharacters';
import { useChats } from '../hooks/useChats';
import { useStore, normalizeChat } from '../store/useStore';
import Avatar from '../components/ui/Avatar';
import { EmptyState, ErrorState, Spinner } from '../components/ui/States';
import { formatCount, relativeTime } from '../lib/format';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { errorMessage } from '../lib/apiError';
import { Button } from '../components/ui/Button';
import { PageContainer } from '../components/ui/Page';
import { Badge } from '../components/ui/Page';

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
  const { user, setAuthModalOpen, setReportModalOpen, notify, upsertChat, askConfirm } = useStore();
  const [starting, setStarting] = useState(false);

  // Prima di ogni ritorno anticipato: gli hook non possono stare sotto un `if`.
  useDocumentTitle(character?.name);

  if (status === 'loading') return <Spinner label="Caricamento del personaggio…" />;

  if (status === 'notfound') {
    return (
      <EmptyState
        icon={<UserX className="h-7 w-7" />}
        title="Personaggio non trovato"
        description="Potrebbe essere stato eliminato, oppure è privato e appartiene a qualcun altro."
        action={<Link to="/discover" className="btn-secondary rounded-xl px-4 py-2 text-sm">Torna a Scopri</Link>}
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
      notify(errorMessage(err, 'Impossibile aprire la conversazione.'), 'error');
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
    /**
     * La conferma arriva dal dialogo condiviso.
     *
     * Qui ce n'era una scritta a mano — corretta, per giunta: usava il modale
     * condiviso, chiudeva con Esc, intrappolava il focus. Il problema non era
     * la sua qualità, era che esisteva solo qui: eliminare un messaggio, una
     * conversazione o disconnettersi non chiedevano niente a nessuno.
     */
    const conferma = await askConfirm({
      title: `Sei sicuro di voler eliminare ${character.name}?`,
      description:
        'Verranno eliminate anche tutte le conversazioni collegate. L\'operazione non è reversibile.'
    });
    if (!conferma) return;

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
    <PageContainer width="prose">
      <Button variant="ghost" size="sm" className="-ml-3 mb-7" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Indietro
      </Button>

      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-start">
        <Avatar src={character.avatar} name={character.name} size={112} rounded="2xl" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="title-display text-display-md">{character.name}</h1>
            {character.isNSFW && (
              <span className="rounded-lg bg-danger/15 px-2 py-0.5 text-micro font-bold text-danger">18+</span>
            )}
            {!character.isPublic && (
              <span className="rounded-lg bg-surface px-2 py-0.5 text-micro font-medium text-ink-muted">Privato</span>
            )}
            {/**
              * «In revisione» è sparito, e la ragione è che diceva il falso.
              *
              * L'etichetta compariva per `moderationStatus === 'pending'`. Con
              * la moderazione successiva quello stato non viene più assegnato:
              * un personaggio pubblico è online appena creato. Ma i personaggi
              * creati PRIMA del cambiamento sono rimasti `pending` in database,
              * e continuavano a mostrare «In revisione» accanto a un
              * personaggio che chiunque poteva già aprire — l'unica etichetta
              * che l'autore vede, e diceva l'esatto contrario della verità.
              *
              * Resta solo lo stato che cambia davvero qualcosa: rimosso.
              */}
            {character.isPublic && character.moderationStatus === 'rejected' && (
              <span className="rounded-lg border border-danger/40 bg-danger/10 px-2 py-0.5 text-micro font-medium text-danger">
                Rimosso
              </span>
            )}
          </div>

          {/* La decisione della moderazione va comunicata all'autore, con la
              sua motivazione: un personaggio che sparisce senza spiegazione è
              indistinguibile da un guasto. */}
          {isOwner && character.moderationStatus === 'rejected' && (
            <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-ink-muted">
              <strong className="text-danger">Rimosso dalla galleria.</strong>{' '}
              {character.moderationReason || 'Nessuna motivazione registrata.'} Puoi modificarlo per
              chiedere un riesame: resta fuori dalla galleria finché qualcuno non lo guarda.
            </p>
          )}

          <p className="mt-0.5 text-xs text-ink-dim">
            di @{creator?.username ?? 'community'}
          </p>

          <p className="mt-3 text-sm leading-relaxed text-ink-muted">{character.description}</p>

          <div className="mt-4 flex items-center gap-4 text-xs text-ink-dim">
            <span className="flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
              {formatCount(character.chatCount ?? character.usageCount)} conversazioni
            </span>
          </div>

          {character.tags?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {character.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
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
          className="btn-ghost flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm"
        >
          <ShieldAlert className="h-4 w-4" aria-hidden="true" /> Segnala
        </button>

        {isOwner && (
          <>
            <Link to={`/create?edit=${character._id}`} className="btn-secondary flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm">
              <Pencil className="h-4 w-4" aria-hidden="true" /> Modifica
            </Link>
            <button
              onClick={remove}
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
                  className="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-accent/60 hover:bg-surface-hover"
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
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="mb-2 eyebrow">Come ti accoglie</h2>
          <p className="text-sm italic leading-relaxed text-ink-muted">«{character.greetingMessage}»</p>
        </section>
      )}

    </PageContainer>
  );
}
