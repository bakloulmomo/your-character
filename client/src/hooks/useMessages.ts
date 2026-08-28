import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import type { Message } from '../store/useStore';

interface State {
  messages: Message[];
  status: 'loading' | 'ready' | 'error' | 'notfound';
  hasMore: boolean;
  loadingOlder: boolean;
}

/**
 * Storico messaggi con scorrimento all'indietro.
 *
 * Il server restituisce ora gli ULTIMI messaggi con un cursore: prima
 * restituiva i primi 100 in ordine crescente, quindi oltre quella soglia la
 * conversazione si congelava all'inizio (S1-12).
 */
export function useMessages(chatId: string | undefined) {
  const [state, setState] = useState<State>({
    messages: [],
    status: 'loading',
    hasMore: false,
    loadingOlder: false
  });
  const cursorRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!chatId) return;
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const res = await api.get(`/messages/${chatId}`, { params: { limit: 50 } });
      cursorRef.current = res.data.nextCursor ?? null;
      setState({
        messages: res.data.messages ?? [],
        status: 'ready',
        hasMore: !!res.data.hasMore,
        loadingOlder: false
      });
    } catch (err: any) {
      setState((s) => ({
        ...s,
        status: err.response?.status === 404 ? 'notfound' : 'error'
      }));
    }
  }, [chatId]);

  useEffect(() => {
    load();
  }, [load]);

  const loadOlder = useCallback(async () => {
    if (!chatId || !cursorRef.current || state.loadingOlder) return;
    setState((s) => ({ ...s, loadingOlder: true }));
    try {
      const res = await api.get(`/messages/${chatId}`, {
        params: { limit: 50, before: cursorRef.current }
      });
      cursorRef.current = res.data.nextCursor ?? null;
      setState((s) => ({
        messages: [...(res.data.messages ?? []), ...s.messages],
        status: 'ready',
        hasMore: !!res.data.hasMore,
        loadingOlder: false
      }));
    } catch {
      setState((s) => ({ ...s, loadingOlder: false }));
    }
  }, [chatId, state.loadingOlder]);

  const setMessages = useCallback((updater: (prev: Message[]) => Message[]) => {
    setState((s) => ({ ...s, messages: updater(s.messages) }));
  }, []);

  return {
    messages: state.messages,
    status: state.status,
    hasMore: state.hasMore,
    loadingOlder: state.loadingOlder,
    loadOlder,
    setMessages,
    reload: load
  };
}
