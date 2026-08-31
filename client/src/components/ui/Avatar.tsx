import { useState } from 'react';
import { initialsOf, tintFor } from '../../lib/format';

interface Props {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
  rounded?: 'full' | 'xl' | '2xl';
  /**
   * Riempie il contenitore invece di stare su un lato fisso.
   *
   * Serve alle locandine del carosello, alte 288px e larghe 208. Prima ci si
   * provava con `className="h-full w-full"`, che però perde contro `width` e
   * `height` scritti nello `style` in linea: l'immagine restava un quadrato di
   * 208px in alto e sotto restavano ottanta pixel di fondo vuoto, con la
   * sfumatura del titolo sospesa sul nulla.
   */
  fill?: boolean;
}

/**
 * Avatar con ripiego sulle iniziali.
 * Prima un URL rotto lasciava l'icona di immagine spezzata del browser: ogni
 * card della galleria dipendeva da immagini Unsplash esterne.
 */
export default function Avatar({
  src, name, size = 40, className = '', rounded = 'xl', fill = false
}: Props) {
  const [failed, setFailed] = useState(false);
  const radius = fill
    ? ''
    : rounded === 'full' ? 'rounded-full' : rounded === '2xl' ? 'rounded-2xl' : 'rounded-xl';
  const box = fill ? { width: '100%', height: '100%' } : { width: size, height: size };

  if (!src || failed) {
    return (
      <div
        className={`${radius} flex shrink-0 items-center justify-center font-semibold text-white ${className}`}
        style={{
          ...box,
          backgroundColor: tintFor(name),
          fontSize: Math.max(11, size * 0.36)
        }}
        aria-hidden="true"
      >
        {initialsOf(name)}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${radius} shrink-0 object-cover ${fill ? '' : 'border border-line'} ${className}`}
      style={box}
    />
  );
}
