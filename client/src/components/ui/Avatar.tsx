import { useState } from 'react';
import { initialsOf, tintFor } from '../../lib/format';

interface Props {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
  rounded?: 'full' | 'md' | 'lg' | 'xl' | '2xl';
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
/**
 * Il ritratto è rettangolare, e non è un dettaglio.
 *
 * Il ripiego predefinito era `rounded-xl` e le pagine chiedevano `rounded="full"`
 * quasi ovunque. Un cerchio intorno a un volto è il segnale più riconoscibile
 * di «applicazione qualsiasi»: lo fanno tutti, quindi non dice niente. Un
 * ritaglio rettangolare è un fotogramma, ed è ciò che un prodotto costruito
 * attorno a dei personaggi dovrebbe sembrare. `rounded="full"` resta
 * disponibile — l'avatar dell'utente nella barra laterale è una persona reale,
 * non un personaggio — ma smette di essere il caso normale.
 */
export default function Avatar({
  src, name, size = 40, className = '', rounded = 'lg', fill = false
}: Props) {
  const [failed, setFailed] = useState(false);
  // `2xl` mappava su `rounded-xl`: il gradino da 10px esisteva come token e
  // non era raggiungibile da qui. Un difetto silenzioso — nessuno se ne
  // accorge, l'angolo è semplicemente sbagliato di due pixel.
  const RADIUS = { full: 'rounded-full', md: 'rounded-md', lg: 'rounded-lg', xl: 'rounded-xl', '2xl': 'rounded-2xl' } as const;
  const radius = fill ? '' : RADIUS[rounded];
  const box = fill ? { width: '100%', height: '100%' } : { width: size, height: size };

  if (!src || failed) {
    return (
      <div
        className={`${radius} font-display flex shrink-0 items-center justify-center font-semibold text-ink ${className}`}
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
      className={`${radius} shrink-0 object-cover ${className}`}
      style={box}
    />
  );
}
