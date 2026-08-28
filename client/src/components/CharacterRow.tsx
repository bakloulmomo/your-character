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
    <section className="mb-10">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
        <div className="flex gap-1">
          <button
            onClick={() => scrollBy(-1)}
            aria-label={`Scorri ${title} indietro`}
            className="btn-secondary rounded-full p-1.5"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            onClick={() => scrollBy(1)}
            aria-label={`Scorri ${title} avanti`}
            className="btn-secondary rounded-full p-1.5"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div ref={scroller} className="scrollbar-none flex gap-4 overflow-x-auto pb-2">
        {characters.map((c) => (
          <CharacterCard key={c._id} character={c} variant={variant} />
        ))}
      </div>
    </section>
  );
}
