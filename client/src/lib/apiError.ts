/**
 * Ricava un messaggio LEGGIBILE da un errore di rete, qualunque forma abbia.
 *
 * Il client leggeva `err.response.data.error` in sedici punti e ne infilava il
 * risultato direttamente in `notify()` o dentro il JSX, dando per scontato che
 * fosse una stringa. Non sempre lo era:
 *
 *  · il gestore globale del server rispondeva `{ error: { message, status,
 *    requestId } }` — un oggetto. React solleva «Objects are not valid as a
 *    React child» e l'intera pagina viene sostituita dalla schermata di
 *    emergenza. Un errore del server produceva il crollo dell'interfaccia
 *    invece di un avviso;
 *  · una rotta API inesistente rispondeva con la pagina HTML di Express, quindi
 *    `data` era markup e `data.error` non esisteva;
 *  · un proxy o un gateway davanti all'applicazione può restituire una pagina
 *    di errore propria, su cui non abbiamo alcun controllo.
 *
 * Le prime due sono state corrette alla fonte. Questa funzione esiste per la
 * terza e per tutte quelle che non abbiamo previsto: il percorso che gestisce
 * gli errori è l'ultimo che può permettersi di romperne uno nuovo.
 */
export function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: unknown } })?.response?.data;

  const fromField = (value: unknown): string | null => {
    if (typeof value === 'string') return value.trim() || null;
    if (value && typeof value === 'object') {
      const message = (value as { message?: unknown }).message;
      if (typeof message === 'string') return message.trim() || null;
    }
    return null;
  };

  if (data && typeof data === 'object') {
    const candidate =
      fromField((data as { error?: unknown }).error) ??
      fromField((data as { message?: unknown }).message);
    if (candidate) return candidate;
  }

  return fallback;
}

/**
 * Il codice HTTP, quando c'è.
 *
 * Un errore di rete — server irraggiungibile, richiesta annullata — non ha
 * risposta e quindi non ha codice: restituisce `undefined`, che è diverso da
 * zero e va distinto da un 500.
 */
export function errorStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}
