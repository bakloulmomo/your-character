import { useCallback, useEffect, useState } from 'react';
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
  const {
    chats, chatsStatus, chatsCursor, chatsHasMore,
    setChats, setChatsStatus, setChatsLoadedFor, appendChats, removeChat, notify
  } = useStore();
  const [loadingMore, setLoadingMore] = useState(false);

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
      /**
       * La continuazione arriva nelle intestazioni, non nel corpo.
       *
       * È una scelta del server: la risposta resta un array, così un client che
       * non conosce la paginazione continua a funzionare. `useStore.setState`
       * invece di un'azione dedicata perché qui si sta rimpiazzando l'elenco,
       * non aggiungendo in coda.
       */
      // `?.` non è prudenza eccessiva: una risposta senza intestazioni —
      // un'API dietro un proxy che le filtra, o un doppio dello strato di rete
      // nei test — faceva lanciare qui, e la cronologia restava «in
      // caricamento» per sempre senza che nulla dicesse perché.
      useStore.setState({
        chatsCursor: res.headers?.['x-next-cursor'] ?? null,
        chatsHasMore: res.headers?.['x-has-more'] === 'true'
      });
      setChatsStatus('ready');
    } catch {
      setChatsStatus('error');
    }
  }, [key, setChats, setChatsStatus, setChatsLoadedFor]);

  /**
   * La pagina successiva della cronologia.
   *
   * Il cursore è il `lastMessageAt` dell'ultima riga già ricevuta, non un
   * numero di pagina: una conversazione che risale in cima mentre si sfoglia
   * non fa saltare né duplicare le righe sotto — e quelle poche che
   * ricomparirebbero comunque le toglie `appendChats`.
   */
  const loadMore = useCallback(async () => {
    const { chatsCursor: cursore, chatsHasMore: altre } = useStore.getState();
    if (!cursore || !altre || loadingMore) return;

    setLoadingMore(true);
    try {
      const res = await api.get('/chats', { params: { before: cursore } });
      appendChats(
        (res.data ?? []).map((raw: any) => normalizeChat(raw)),
        res.headers?.['x-next-cursor'] ?? null,
        res.headers?.['x-has-more'] === 'true'
      );
    } catch {
      notify('Non è stato possibile caricare altre conversazioni.', 'error');
    } finally {
      setLoadingMore(false);
    }
  }, [appendChats, notify, loadingMore]);

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

  return { chats, status: chatsStatus, reload: load, deleteChat, loadMore, hasMore: chatsHasMore, loadingMore, cursor: chatsCursor };
}
