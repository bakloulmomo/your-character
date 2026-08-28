import { Link } from 'react-router-dom';
import { MessageSquare, ShieldAlert, Clock3 } from 'lucide-react';
import Avatar from './ui/Avatar';
import { formatCount } from '../lib/format';
import { useStore, type Character } from '../store/useStore';

interface Props {
  character: Character;
  variant?: 'grid' | 'row' | 'poster';
}

const creatorName = (character: Character) => {
  const by = character.createdBy;
  if (by && typeof by === 'object' && by.username) return by.username;
  return 'community';
};

/**
 * Card di un personaggio — un solo componente per tutte le viste.
 *
 * Prima lo stesso markup era duplicato tre volte dentro ExploreView, con
 * metadati inventati (`+Lore` fisso, conteggi sempre a zero) e un `onClick`
 * che creava immediatamente una chat persistente. Ora è un link alla scheda
 * del personaggio: la conversazione si apre da lì, deliberatamente (S3-7, S3-11).
 */
export default function CharacterCard({ character, variant = 'grid' }: Props) {
  const setReportModalOpen = useStore((s) => s.setReportModalOpen);
  const chats = formatCount(character.chatCount ?? character.usageCount);

  // Un personaggio pubblico in attesa di revisione compare solo al suo autore,
  // in «I miei personaggi»: senza un'etichetta sembrerebbe già in galleria.
  const pendingBadge = character.isPublic && character.moderationStatus === 'pending' ? (
    <span className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
      <Clock3 className="h-3 w-3" aria-hidden="true" /> In revisione
    </span>
  ) : character.isPublic && character.moderationStatus === 'rejected' ? (
    <span className="inline-flex items-center gap-1 rounded-md border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[10px] font-medium text-danger">
      Respinto
    </span>
  ) : null;

  const reportButton = (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setReportModalOpen(true, { type: 'character', id: character._id });
      }}
      aria-label={`Segnala ${character.name}`}
      className="btn-ghost rounded-lg p-1.5 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
    >
      <ShieldAlert className="h-4 w-4" aria-hidden="true" />
    </button>
  );

  if (variant === 'poster') {
    return (
      <Link
        to={`/character/${character._id}`}
        className="group relative block h-72 w-52 shrink-0 overflow-hidden rounded-2xl border border-line bg-surface transition-colors hover:border-sapphire/60"
      >
        <Avatar src={character.avatar} name={character.name} size={208} rounded="2xl" className="h-full w-full !rounded-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />
        <div className="absolute inset-x-3 bottom-3">
          <h3 className="font-display text-sm font-semibold leading-tight text-white">{character.name}</h3>
          <p className="mt-0.5 truncate font-mono text-[10px] text-white/60">@{creatorName(character)}</p>
          <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-white/75">{character.description}</p>
        </div>
        {character.isNSFW && (
          <span className="absolute right-2 top-2 rounded-md bg-danger/90 px-1.5 py-0.5 text-[9px] font-bold text-white">
            18+
          </span>
        )}
      </Link>
    );
  }

  if (variant === 'row') {
    return (
      <Link
        to={`/character/${character._id}`}
        className="group flex h-28 w-72 shrink-0 gap-3 rounded-2xl border border-line bg-surface p-3 transition-colors hover:border-sapphire/60 hover:bg-surface-hover"
      >
        <Avatar src={character.avatar} name={character.name} size={56} />
        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-ink transition-colors group-hover:text-sapphire-glow">
              {character.name}
            </h3>
            <p className="truncate font-mono text-[10px] text-ink-dim">@{creatorName(character)}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-snug text-ink-muted">{character.description}</p>
          </div>
          <div className="flex items-center gap-1 font-mono text-[10px] text-ink-dim">
            <MessageSquare className="h-3 w-3" aria-hidden="true" />
            <span>{chats}</span>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link
      to={`/character/${character._id}`}
      className="group flex flex-col justify-between rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-sapphire/60 hover:bg-surface-hover"
    >
      <div>
        <div className="mb-3 flex items-start justify-between gap-3">
          <Avatar src={character.avatar} name={character.name} size={48} />
          {reportButton}
        </div>
        <h3 className="truncate text-sm font-semibold text-ink transition-colors group-hover:text-sapphire-glow">
          {character.name}
        </h3>
        <p className="mb-2 truncate font-mono text-[10px] text-ink-dim">@{creatorName(character)}</p>
        {pendingBadge && <div className="mb-2">{pendingBadge}</div>}
        <p className="line-clamp-2 text-xs leading-relaxed text-ink-muted">{character.description}</p>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2.5">
        <div className="flex flex-wrap gap-1">
          {character.tags?.slice(0, 2).map((tag) => (
            <span key={tag} className="rounded-md bg-sapphire-wash px-1.5 py-0.5 text-[9px] font-medium text-sapphire-glow">
              {tag}
            </span>
          ))}
          {character.isNSFW && (
            <span className="rounded-md bg-danger/15 px-1.5 py-0.5 text-[9px] font-bold text-danger">18+</span>
          )}
        </div>
        <div className="flex items-center gap-1 font-mono text-[10px] text-ink-dim">
          <MessageSquare className="h-3 w-3" aria-hidden="true" />
          <span>{chats}</span>
        </div>
      </div>
    </Link>
  );
}
