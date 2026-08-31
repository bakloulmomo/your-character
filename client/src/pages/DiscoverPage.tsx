import { useState } from 'react';
import { Compass } from 'lucide-react';
import { useCharacters } from '../hooks/useCharacters';
import { useStore } from '../store/useStore';
import CharacterCard from '../components/CharacterCard';
import CharacterRow from '../components/CharacterRow';
import { CardSkeleton, EmptyState, ErrorState } from '../components/ui/States';
import { useDocumentTitle } from '../lib/useDocumentTitle';

// Le categorie sono quelle realmente accettate dal server, non etichette
// decorative: prima Feed / Charms / Labs non filtravano nulla (S3-2, S3-3).
const CATEGORIES = [
  { id: 'all', label: 'Tutti' },
  { id: 'assistant', label: 'Assistenti' },
  { id: 'anime', label: 'Anime' },
  { id: 'gaming', label: 'Gaming' },
  { id: 'fantasy', label: 'Fantasy' },
  { id: 'historical', label: 'Storici' },
  { id: 'roleplay', label: 'Roleplay' },
  { id: 'custom', label: 'Altro' }
];

export default function DiscoverPage() {
  useDocumentTitle();
  const user = useStore((s) => s.user);
  const [category, setCategory] = useState('all');

  // Query distinte, non lo stesso array filtrato quattro volte in pagina.
  const featured = useCharacters({ category, limit: 24 });
  const anime = useCharacters({ category: 'anime', limit: 12, enabled: category === 'all' });
  const gaming = useCharacters({ category: 'gaming', limit: 12, enabled: category === 'all' });

  /**
   * I caroselli mostrano solo ciò che non è già nella griglia sopra.
   *
   * «In evidenza» chiede i primi 24 personaggi senza filtro di categoria: su un
   * catalogo piccolo li contiene quasi tutti, e le righe «Anime» e «Gaming»
   * ripresentavano gli stessi identici personaggi qualche centimetro più in
   * basso. Tre sezioni con nomi diversi e lo stesso contenuto fanno sembrare il
   * catalogo più grande di quello che è, che è esattamente il difetto opposto a
   * quello che una galleria dovrebbe fare.
   */
  const shown = new Set(featured.characters.map((c) => c._id));
  const notAlreadyShown = (list: typeof featured.characters) => list.filter((c) => !shown.has(c._id));

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8">
      <header className="mb-8">
        <p className="text-xs text-ink-dim">Ti diamo il benvenuto,</p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-ink">
          {user ? `@${user.username}` : 'Viandante'}
        </h1>
      </header>

      {/* Chip di categoria: cambiano davvero la query */}
      <div className="scrollbar-none -mx-1 mb-8 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Categorie">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={category === c.id}
            onClick={() => setCategory(c.id)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-xs font-medium transition-colors ${
              category === c.id
                ? 'border-sapphire bg-sapphire text-white'
                : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {featured.status === 'loading' && <CardSkeleton />}

      {featured.status === 'error' && (
        <ErrorState
          title="Non riusciamo a caricare i personaggi"
          description="Il server non ha risposto. Controlla la connessione e riprova."
          onRetry={featured.reload}
        />
      )}

      {featured.status === 'ready' && featured.characters.length === 0 && (
        <EmptyState
          icon={<Compass className="h-7 w-7" />}
          title={category === 'all' ? 'Non c\'è ancora nessun personaggio' : 'Nessun personaggio in questa categoria'}
          description={
            category === 'all'
              ? 'La galleria è vuota. Crea il primo personaggio e comincia a conversare.'
              : 'Prova un\'altra categoria, oppure creane uno tu.'
          }
        />
      )}

      {featured.status === 'ready' && featured.characters.length > 0 && (
        <>
          <section className="mb-10">
            <h2 className="mb-3 font-display text-lg font-semibold text-ink">
              {category === 'all' ? 'In evidenza' : CATEGORIES.find((c) => c.id === category)?.label}
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {featured.characters.map((c) => (
                <CharacterCard key={c._id} character={c} />
              ))}
            </div>
          </section>

          {category === 'all' && anime.status === 'ready' && (
            <CharacterRow title="Anime" characters={notAlreadyShown(anime.characters)} variant="poster" />
          )}
          {category === 'all' && gaming.status === 'ready' && (
            <CharacterRow title="Gaming" characters={notAlreadyShown(gaming.characters)} />
          )}
        </>
      )}
    </div>
  );
}
