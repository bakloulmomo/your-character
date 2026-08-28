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
  const { chats, chatsStatus, setChats, setChatsStatus, user, removeChat, notify } = useStore();

  const load = useCallback(async () => {
    if (!user) {
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
  }, [user, setChats, setChatsStatus]);

  useEffect(() => {
    load();
  }, [load]);

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
