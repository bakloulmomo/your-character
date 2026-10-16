import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import Avatar from './ui/Avatar';
import { formatCount } from '../lib/format';
import { useStore, type Character } from '../store/useStore';

interface Props {
  character: Character;
  variant?: 'grid' | 'row' | 'poster';
}

/**
 * Voce di catalogo di un personaggio.
 *
 * ─── Cosa è stato tolto, e perché ───
 *
 * La versione precedente mostrava sette cose per ogni personaggio: ritratto,
 * sfumatura, nome, «di @autore», descrizione, due etichette azzurre e un
 * contatore di conversazioni. Moltiplicato per dodici voci in griglia sono
 * ottantaquattro elementi che chiedono attenzione per dirne una: chi è questo.
 *
 * Restano tre cose — ritratto, nome, descrizione — più una riga di metadati
 * sottile che si legge solo se la si cerca. Nello specifico sono spariti:
 *
 *  · LE ETICHETTE COLORATE. `bg-accent-wash text-accent-glow` su ogni tag
 *    metteva due macchie azzurre per scheda, ventiquattro in pagina, per un
 *    dato che nessuno usa per scegliere. I tag ora sono testo grigio in fondo,
 *    separati da un punto medio, come in un colophon.
 *
 *  · «DI @SYSTEM_ADMIN». Su un catalogo curato l'autore è sempre lo stesso e
 *    l'informazione è rumore. Compare solo quando il personaggio è di un utente
 *    vero, che è l'unico caso in cui dice qualcosa.
 *
 *  · L'ICONA DEL CONTATORE. Il numero da solo con la parola accanto si legge
 *    meglio del numero preceduto da un fumetto grande quanto lui.
 *
 *  · IL SOLLEVAMENTO AL PASSAGGIO DEL MOUSE. Con dodici schede in pagina,
 *    oggetti che si alzano quando ci passi sopra sono un campo minato.
 */
const creatorName = (character: Character) => {
  const by = character.createdBy;
  if (by && typeof by === 'object' && by.username) return by.username;
  return null;
};

/** L'autore si nomina solo se non è il catalogo stesso. */
const CURATED = new Set(['system_admin', 'community', 'catalogo']);

export default function CharacterCard({ character, variant = 'grid' }: Props) {
  const setReportModalOpen = useStore((s) => s.setReportModalOpen);
  const chats = formatCount(character.chatCount ?? character.usageCount);
  const author = creatorName(character);
  const showAuthor = author && !CURATED.has(author);

  /**
   * Stato di revisione: solo testo, nessun riquadro colorato.
   * È un'informazione che riguarda il proprietario e compare solo a lui, in
   * «I miei personaggi». Non merita un badge che urla in una galleria.
   */
  /**
   * Resta un solo stato da segnalare: «Rimosso».
   *
   * C'era anche «In revisione», per i personaggi pubblici in attesa di
   * approvazione. Quello stato non esiste più: un personaggio pubblico è
   * visibile appena creato, e la revisione umana avviene dopo, su ciò che è già
   * online. Un'etichetta che dicesse «in revisione» accanto a un personaggio
   * che chiunque può già aprire direbbe una cosa falsa all'autore.
   */
  const status =
    character.isPublic && character.moderationStatus === 'rejected' ? (
      <span className="text-micro font-medium text-danger">Rimosso</span>
    ) : null;

  /**
   * Riga dei metadati: un solo filo di testo, tutto nello stesso grigio.
   * Il punto medio è il separatore dei colophon, e costa meno di un bordo.
   */
  const meta = (
    <p className="tabular truncate text-micro text-ink-dim">
      {[
        showAuthor ? `@${author}` : null,
        character.isNSFW ? '18+' : null,
        chats !== '0' ? `${chats} conversazioni` : null,
        ...(character.tags?.slice(0, 2) ?? [])
      ]
        .filter(Boolean)
        .join(' · ')}
    </p>
  );

  /* ── Locandina: carosello orizzontale ─────────────────────────────────── */
  if (variant === 'poster') {
    return (
      <Link
        to={`/character/${character._id}`}
        className="group block w-48 shrink-0"
      >
        <div className="relative mb-3 aspect-[3/4] overflow-hidden rounded-lg bg-surface">
          <Avatar src={character.avatar} name={character.name} size={256} fill className="portrait" />
        </div>
        <h3 className="title-display truncate text-base leading-snug">{character.name}</h3>
        <p className="mt-1 line-clamp-2 text-xs leading-snug text-ink-muted">{character.description}</p>
      </Link>
    );
  }

  /* ── Riga: carosello compatto ─────────────────────────────────────────── */
  if (variant === 'row') {
    return (
      <Link
        to={`/character/${character._id}`}
        className="group flex w-72 shrink-0 items-start gap-3.5"
      >
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-surface">
          <Avatar src={character.avatar} name={character.name} size={56} fill className="portrait" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="title-display truncate text-base leading-snug transition-colors group-hover:text-accent-glow">
            {character.name}
          </h3>
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-ink-muted">{character.description}</p>
        </div>
      </Link>
    );
  }

  /* ── Griglia: la vista principale della galleria ──────────────────────── */
  return (
    <Link to={`/character/${character._id}`} className="group relative block">
      {/**
        * Il ritratto NON ha una sfumatura sopra e il nome NON ci sta dentro.
        * Prima il testo galleggiava sull'immagine dietro una velatura scura:
        * costa leggibilità, costa un elemento in più, e obbliga a scurire la
        * foto proprio nel punto in cui è più interessante. Il nome sta sotto,
        * dove si legge.
        */}
      <div className="relative mb-3.5 aspect-[4/5] overflow-hidden rounded-lg bg-surface">
        <Avatar src={character.avatar} name={character.name} size={280} fill className="portrait" />

        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setReportModalOpen(true, { type: 'character', id: character._id });
          }}
          aria-label={`Segnala ${character.name}`}
          className="hover-action absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-md
                     bg-bg/60 text-ink-muted backdrop-blur-sm transition-colors hover:text-ink"
        >
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <h3 className="title-display truncate text-display-sm transition-colors group-hover:text-accent-glow">
          {character.name}
        </h3>
        {status}
      </div>
      <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-muted">{character.description}</p>
      <div className="mt-2">{meta}</div>
    </Link>
  );
}
