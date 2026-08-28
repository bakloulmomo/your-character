import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import type { Character } from '../store/useStore';

export type LoadStatus = 'loading' | 'ready' | 'error';

interface Options {
  category?: string;
  search?: string;
  limit?: number;
  /** Se falso la richiesta non parte (es. ricerca con termine vuoto). */
  enabled?: boolean;
}

/**
 * Elenco di personaggi con stato esplicito.
 *
 * Ogni vista aveva la propria fetch inlinata e nessuna aveva stati di
 * caricamento, errore o vuoto: un errore di rete si traduceva in una pagina
 * silenziosamente vuota o, peggio, in sette personaggi inventati (S3-12).
 */
export function useCharacters({ category, search, limit = 20, enabled = true }: Options = {}) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    if (!enabled) {
      setCharacters([]);
      setStatus('ready');
      setTotal(0);
      return;
    }

    setStatus('loading');
    try {
      const params: Record<string, string | number> = { limit };
      if (category && category !== 'all') params.category = category;
      if (search) params.search = search;

      const res = await api.get('/characters', { params });
      setCharacters(res.data.characters ?? []);
      setTotal(res.data.pagination?.total ?? 0);
      setStatus('ready');
    } catch {
      setCharacters([]);
      setTotal(0);
      setStatus('error');
    }
  }, [category, search, limit, enabled]);

  useEffect(() => {
    load();
  }, [load]);

  return { characters, status, total, reload: load };
}

/**
 * Dettaglio di un singolo personaggio.
 *
 * Lo stato `restricted` esiste per i contenuti per adulti (FASE D — S2-3): un
 * 403 con richiesta di verifica dell'età non è un guasto e non è un «non
 * trovato», è una condizione che l'utente può risolvere da solo — e va detta.
 */
export function useCharacter(id: string | undefined) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [status, setStatus] = useState<LoadStatus | 'notfound' | 'restricted'>('loading');

  useEffect(() => {
    let cancelled = false;
    if (!id) return;

    setStatus('loading');
    api
      .get(`/characters/${id}`)
      .then((res) => {
        if (cancelled) return;
        setCharacter(res.data);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        // 404 e 400 sono risposte legittime, non guasti: un personaggio
        // inesistente o privato deve dare una pagina "non trovato", non un errore.
        const code = err.response?.status;
        if (code === 403 && err.response?.data?.requiresAgeVerification) {
          setStatus('restricted');
          return;
        }
        setStatus(code === 404 || code === 400 ? 'notfound' : 'error');
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  return { character, status };
}

/** Personaggi creati dall'utente autenticato. */
export function useMyCharacters(enabled: boolean) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');

  const load = useCallback(async () => {
    if (!enabled) {
      setCharacters([]);
      setStatus('ready');
      return;
    }
    setStatus('loading');
    try {
      const res = await api.get('/characters/my-characters');
      setCharacters(res.data ?? []);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [enabled]);

  useEffect(() => {
    load();
  }, [load]);

  return { characters, status, reload: load };
}
