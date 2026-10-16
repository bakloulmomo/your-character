import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, SearchX } from 'lucide-react';
import { useCharacters } from '../hooks/useCharacters';
import CharacterCard from '../components/CharacterCard';
import { CardSkeleton, EmptyState, ErrorState } from '../components/ui/States';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { PageContainer, PageHeader } from '../components/ui/Page';

/**
 * Pagina di ricerca con indirizzo proprio.
 *
 * Prima esistevano due campi di ricerca, entrambi collegati a una variabile che
 * nessun filtro e nessuna chiamata leggeva mai: digitare non produceva alcun
 * effetto (S3-1).
 */
export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const initial = params.get('q') ?? '';
  const [term, setTerm] = useState(initial);
  const [debounced, setDebounced] = useState(initial);

  useDocumentTitle(debounced ? `Cerca «${debounced}»` : 'Cerca');

  /**
   * L'indirizzo resta la fonte di verità: il termine è condivisibile.
   *
   * ─── La corsa che c'era qui ───
   *
   * Questo effetto riscriveva la query dopo 300 ms. Chi cercava e apriva un
   * risultato PRIMA che il timer scattasse si ritrovava sulla scheda del
   * personaggio con la ricerca appiccicata in coda:
   *
   *     /character/650000000000000000000002?q=marc
   *
   * Il timer era già in coda nel momento del click: scattava dopo che il
   * router aveva cambiato pagina, e `setParams` scrive sempre sull'indirizzo
   * CORRENTE — che a quel punto non era più quello della ricerca. Un indirizzo
   * sporco è condivisibile quanto uno pulito, quindi il difetto si propagava a
   * ogni link copiato.
   *
   * Due guardie, e servono entrambe:
   *
   *  1. NON SI SCRIVE SE NON CAMBIA NULLA. Arrivando da `/search?q=marc` il
   *     termine è già nell'indirizzo: la riscrittura era pura cerimonia, e
   *     toglierla elimina il caso più frequente alla radice.
   *
   *  2. NON SI SCRIVE DOPO LO SMONTAGGIO. Copre il caso in cui il termine è
   *     davvero cambiato (si è digitato ancora, poi si è cliccato in fretta):
   *     lì la prima guardia non basta, perché una scrittura ci sarebbe.
   */
  const currentQuery = params.get('q') ?? '';

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      if (!alive) return;
      const next = term.trim();
      setDebounced(next);
      if (next !== currentQuery) {
        setParams(next ? { q: next } : {}, { replace: true });
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [term, currentQuery, setParams]);

  const { characters, status, total, reload } = useCharacters({
    search: debounced,
    limit: 50,
    enabled: debounced.length > 0
  });

  return (
    <PageContainer width="wide">
      <PageHeader eyebrow="Galleria" title="Cerca" className="mb-8" />

      <form onSubmit={(e) => e.preventDefault()} role="search" className="mb-8">
        <label htmlFor="search-input" className="sr-only">Cerca personaggi per nome, descrizione o tag</label>
        <div className="relative max-w-xl">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-dim" aria-hidden="true" />
          <input
            id="search-input"
            type="search"
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Nome, descrizione o tag…"
            className="input-field rounded-full py-3 pl-11"
          />
        </div>
      </form>

      {debounced.length === 0 && (
        <EmptyState
          icon={<SearchIcon className="h-7 w-7" />}
          title="Cosa stai cercando?"
          description="Scrivi il nome di un personaggio, un argomento o un tag."
        />
      )}

      {debounced.length > 0 && status === 'loading' && <CardSkeleton count={4} />}

      {debounced.length > 0 && status === 'error' && (
        <ErrorState title="Ricerca non riuscita" description="Il server non ha risposto." onRetry={reload} />
      )}

      {debounced.length > 0 && status === 'ready' && characters.length === 0 && (
        <EmptyState
          icon={<SearchX className="h-7 w-7" />}
          title={`Nessun risultato per "${debounced}"`}
          description="Nessun personaggio corrisponde. Prova con un altro termine."
        />
      )}

      {debounced.length > 0 && status === 'ready' && characters.length > 0 && (
        <>
          <p className="mb-4 text-sm text-ink-muted">
            {total} {total === 1 ? 'risultato' : 'risultati'} per «{debounced}»
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {characters.map((c) => (
              <CharacterCard key={c._id} character={c} />
            ))}
          </div>
        </>
      )}
    </PageContainer>
  );
}
