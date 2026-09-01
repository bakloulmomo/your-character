import { useState } from 'react';
import { Link } from 'react-router-dom';
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
   * «In evidenza» chiede i primi 24 personaggi senza filtro: su un catalogo
   * piccolo li contiene quasi tutti, e le righe «Anime» e «Gaming»
   * ripresentavano gli stessi personaggi qualche centimetro più in basso. Tre
   * sezioni con nomi diversi e lo stesso contenuto fanno sembrare il catalogo
   * più grande di quello che è.
   */
  const shown = new Set(featured.characters.map((c) => c._id));
  const notAlreadyShown = (list: typeof featured.characters) => list.filter((c) => !shown.has(c._id));

  const heading = category === 'all'
    ? 'In evidenza'
    : CATEGORIES.find((c) => c.id === category)?.label ?? 'Personaggi';

  return (
    <div className="mx-auto w-full max-w-[76rem] px-6 py-14 md:px-10 lg:px-14">
      {/**
        * Intestazione: due righe, non quattro.
        *
        * Prima c'erano un'etichetta, un titolo, e due righe di sottotitolo che
        * spiegavano il prodotto a chi lo stava già usando. Il testo esplicativo
        * è la forma più comune di rumore: sembra utile e non lo è, perché chi è
        * arrivato qui ha già capito dove si trova. Resta il titolo, che dice
        * cosa fare, e il saluto, che resta piccolo perché è una cortesia.
        */}
      <header className="mb-12">
        <h1 className="title-serif text-display-lg">Scegli con chi parlare</h1>
        {user && (
          <p className="mt-3 text-sm text-ink-dim">Bentornato, @{user.username}</p>
        )}
      </header>

      {/**
        * Filtri.
        *
        * Erano otto pastiglie con bordo e fondo, di cui una azzurra piena:
        * otto oggetti disegnati per un'operazione che è un cambio di vista. Ora
        * sono testo. L'attivo si distingue per COLORE DELL'INCHIOSTRO e peso —
        * il modo in cui si è sempre segnalata una voce corrente in un indice —
        * invece che per un riquadro colorato.
        *
        * Il ruolo resta `group` con `aria-pressed`: filtrare non è cambiare
        * scheda, e promettere una semantica a schede senza le frecce che quella
        * semantica implica sarebbe una promessa non mantenuta.
        */}
      <div
        role="group"
        aria-label="Filtra per categoria"
        className="scrollbar-none fade-edge-r -mx-1 mb-10 flex gap-5 overflow-x-auto px-1 pb-1"
      >
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            aria-pressed={category === c.id}
            onClick={() => setCategory(c.id)}
            className={`shrink-0 text-sm transition-colors duration-150 ${
              category === c.id
                ? 'font-medium text-ink'
                : 'text-ink-dim hover:text-ink-muted'
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
          <section className="mb-14">
            <div className="rule mb-7 flex items-baseline justify-between gap-4 pt-5">
              <h2 className="title-serif text-display-sm">{heading}</h2>
              <span className="tabular text-micro text-ink-dim">
                {featured.characters.length}
              </span>
            </div>

            {/**
              * `auto-fill` con una larghezza minima, non un numero fisso di
              * colonne: con due personaggi in catalogo, `xl:grid-cols-4`
              * riservava comunque quattro colonne e mezza pagina restava
              * vuota. Le distanze sono larghe — 2rem in orizzontale, 3.5rem in
              * verticale — perché senza bordi è lo spazio a dire dove finisce
              * una voce e dove comincia la successiva.
              */}
            <div className="grid gap-x-8 gap-y-14 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
              {featured.characters.map((c) => (
                <CharacterCard key={c._id} character={c} />
              ))}

              {/* L'invito a creare chiude la griglia: con un catalogo piccolo
                  evita il mezzo schermo vuoto, e resta utile anche dopo. */}
              <Link
                to="/create"
                className="group flex flex-col"
              >
                <div className="mb-3.5 flex aspect-[4/5] items-center justify-center rounded-lg
                                border border-dashed border-line transition-colors
                                group-hover:border-line-strong">
                  <span className="text-2xl font-light text-ink-dim transition-colors group-hover:text-ink-muted">
                    +
                  </span>
                </div>
                <h3 className="title-serif text-display-sm text-ink-muted transition-colors group-hover:text-ink">
                  Crea il tuo
                </h3>
              </Link>
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
