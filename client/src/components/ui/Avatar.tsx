import { useState } from 'react';
import { initialsOf, tintFor } from '../../lib/format';

interface Props {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
  rounded?: 'full' | 'xl' | '2xl';
}

/**
 * Avatar con ripiego sulle iniziali.
 * Prima un URL rotto lasciava l'icona di immagine spezzata del browser: ogni
 * card della galleria dipendeva da immagini Unsplash esterne.
 */
export default function Avatar({ src, name, size = 40, className = '', rounded = 'xl' }: Props) {
  const [failed, setFailed] = useState(false);
  const radius = rounded === 'full' ? 'rounded-full' : rounded === '2xl' ? 'rounded-2xl' : 'rounded-xl';

  if (!src || failed) {
    return (
      <div
        className={`${radius} flex shrink-0 items-center justify-center font-semibold text-white ${className}`}
        style={{
          width: size,
          height: size,
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
      className={`${radius} shrink-0 border border-line object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
