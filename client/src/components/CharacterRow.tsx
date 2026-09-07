import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import CharacterCard from './CharacterCard';
import type { Character } from '../store/useStore';

interface Props {
  title: string;
  characters: Character[];
  variant?: 'row' | 'poster';
}

/**
 * Carosello orizzontale.
 *
 * Definito al livello del modulo, non dentro il componente padre: prima veniva
 * ricreato a ogni render, quindi ogni tasto premuto nella ricerca smontava e
 * rimontava tutti i caroselli, azzerando lo scorrimento (S3-24).
 */
export default function CharacterRow({ title, characters, variant = 'row' }: Props) {
  const scroller = useRef<HTMLDivElement>(null);

  if (characters.length === 0) return null;

  const scrollBy = (direction: -1 | 1) => {
    scroller.current?.scrollBy({ left: direction * 340, behavior: 'smooth' });
  };

  return (
    <section className="mb-14">
      {/* Il titolo di sezione poggia su un filo, come in una rivista: la riga
          separa senza chiudere, e costa un bordo invece di quattro. */}
      <div className="rule mb-5 flex items-baseline justify-between gap-4 pt-5">
        <h2 className="title-display text-display-sm">{title}</h2>
        {/* Le frecce non hanno più un contorno pieno: sono due glifi che
            rispondono al mouse. Erano due pastiglie identiche ai pulsanti
            d'azione, e pesavano quanto il titolo che accompagnavano. */}
        <div className="flex gap-0.5">
          <button
            onClick={() => scrollBy(-1)}
            aria-label={`Scorri ${title} indietro`}
            className="btn-ghost rounded-md p-1.5"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            onClick={() => scrollBy(1)}
            aria-label={`Scorri ${title} avanti`}
            className="btn-ghost rounded-md p-1.5"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div ref={scroller} className="scrollbar-none flex gap-6 overflow-x-auto pb-2">
        {characters.map((c) => (
          <CharacterCard key={c._id} character={c} variant={variant} />
        ))}
      </div>
    </section>
  );
}
