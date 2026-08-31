import { useEffect } from 'react';

const BASE = 'your-character';
const HOME = `${BASE} — conversazioni con personaggi che crei tu`;

/**
 * Titolo della scheda del browser, pagina per pagina.
 *
 * Il titolo era una costante scritta in `index.html`: ogni scheda, ogni
 * segnalibro e ogni voce della cronologia si chiamava «your-character». Con una
 * decina di conversazioni aperte in altrettante schede erano indistinguibili, e
 * tornare indietro nella cronologia significava scegliere alla cieca fra righe
 * identiche. Su una pagina con un pulsante «Condividi» il difetto si vedeva
 * anche fuori: il titolo è la prima cosa che chi riceve il link legge.
 *
 * Passare `undefined` (per esempio mentre il personaggio sta caricando) lascia
 * il titolo generico invece di scrivere «undefined» nella scheda.
 */
export function useDocumentTitle(title?: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${BASE}` : HOME;
  }, [title]);
}
