import { useCallback, useEffect } from 'react';
import api from '../services/api';
import { useStore, normalizeChat } from '../store/useStore';

/**
 * Cronologia delle conversazioni.
 *
 * `GET /chats` esisteva sul server dal primo giorno e non veniva mai chiamato:
 * l'interfaccia non aveva alcuna cronologia, quindi ogni click su un
 * personaggio creava una chat nuova e nessuna era più raggiungibile (S3-6).
 */
export function useChats() {
  const { chats, chatsStatus, setChats, setChatsStatus, setChatsLoadedFor, removeChat, notify } =
    useStore();

  /**
   * Solo l'identificativo, non l'intero oggetto utente.
   *
   * `updateCredits` ricrea l'oggetto dopo OGNI messaggio inviato: con l'oggetto
   * fra le dipendenze, `load` cambiava identità a ogni battuta e la cronologia
   * si ricaricava da capo in mezzo alla conversazione.
   */
  const key = useStore((s) => s.user?.id ?? 'anon');

  const load = useCallback(async () => {
    // Segnato subito, prima di qualunque attesa: è ciò che permette alla
    // seconda copia dell'hook — montata nello stesso istante — di vedere che la
    // richiesta è già partita.
    setChatsLoadedFor(key);

    if (key === 'anon') {
      setChats([]);
      setChatsStatus('ready');
      return;
    }

    setChatsStatus('loading');
    try {
      const res = await api.get('/chats');
      setChats((res.data ?? []).map((raw: any) => normalizeChat(raw)));
      setChatsStatus('ready');
    } catch {
      setChatsStatus('error');
    }
  }, [key, setChats, setChatsStatus, setChatsLoadedFor]);

  useEffect(() => {
    /**
     * Una sola richiesta per utente, anche se l'hook è montato più volte.
     *
     * La barra laterale e la pagina aperta (scheda personaggio o conversazione)
     * usano entrambe questo hook: ogni copia faceva partire il proprio
     * `GET /chats`, quindi la stessa risposta veniva scaricata due o tre volte a
     * ogni cambio di pagina. Lo stato era già condiviso nello store — mancava
     * solo la memoria di averlo già chiesto. `reload()` resta esplicito e
     * ignora questo controllo.
     *
     * Letto da `getState()` e non da una dipendenza: serve a decidere se
     * partire, non a far ripartire l'effetto quando cambia.
     */
    if (useStore.getState().chatsLoadedFor === key) return;
    load();
  }, [load, key]);

  const deleteChat = useCallback(
    async (chatId: string) => {
      try {
        await api.delete(`/chats/${chatId}`);
        removeChat(chatId);
        notify('Conversazione eliminata.', 'success');
        return true;
      } catch {
        notify('Non è stato possibile eliminare la conversazione.', 'error');
        return false;
      }
    },
    [removeChat, notify]
  );

  return { chats, status: chatsStatus, reload: load, deleteChat };
}
