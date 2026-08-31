/**
 * Avvio dell'applicazione: la sessione non si chiude da sola.
 *
 * All'avvio il client chiede `GET /auth/me` per ricostruire la sessione dal
 * cookie httpOnly, che nessuno script può leggere. Il ramo di errore chiamava
 * `logout()`, che parla ANCHE col server. Due conseguenze:
 *
 *  · ogni visitatore anonimo faceva partire una `POST /auth/logout` inutile a
 *    ogni caricamento di pagina — la risposta a `/auth/me` per un anonimo è un
 *    401, cioè il caso normale, non un guasto;
 *  · un errore di rete passeggero faceva cancellare al server il cookie di
 *    sessione. Bastava un istante di connessione incerta nel momento sbagliato
 *    per essere disconnessi davvero, e per farlo su OGNI dispositivo.
 *
 * È il genere di difetto che non produce un'eccezione: fa in silenzio la cosa
 * sbagliata, e chi la subisce pensa di aver sbagliato la password.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import App from '../App';
import { useStore } from '../store/useStore';
import { resetStore, testUser } from '../test/helpers';
import api from '../services/api';

vi.mock('../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  setAuthToken: vi.fn()
}));

const mockedApi = vi.mocked(api);

const logoutCalls = () => mockedApi.post.mock.calls.filter(([url]) => url === '/auth/logout');

describe("avvio dell'applicazione", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    mockedApi.post.mockResolvedValue({ data: {} });
  });

  it('un 401 da visitatore anonimo non chiede al server di chiudere alcuna sessione', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.reject({ response: { status: 401 } });
      return Promise.resolve({ data: {} });
    });

    render(<App />);

    await waitFor(() => expect(useStore.getState().isAuthResolved).toBe(true));
    expect(logoutCalls()).toHaveLength(0);
  });

  it('un errore di rete non disconnette dal server chi era connesso', async () => {
    // Lo stato locale si azzera — non sappiamo chi sia — ma il cookie resta
    // valido, quindi il caricamento successivo ritrova la sessione.
    resetStore({ user: testUser() });
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.reject(new Error('rete assente'));
      return Promise.resolve({ data: {} });
    });

    render(<App />);

    await waitFor(() => expect(useStore.getState().isAuthResolved).toBe(true));
    expect(logoutCalls()).toHaveLength(0);
    expect(useStore.getState().user).toBeNull();
  });
});
