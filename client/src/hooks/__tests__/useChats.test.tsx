/**
 * La cronologia si scarica una volta sola, anche se la chiedono in due.
 *
 * `useChats()` è montato contemporaneamente dalla barra laterale (sempre
 * presente) e dalla pagina aperta — scheda personaggio o conversazione. Ogni
 * copia faceva partire il proprio `GET /chats`: la stessa risposta veniva
 * scaricata due volte a ogni cambio di pagina, e tre quando anche la pagina ne
 * chiedeva il ricaricamento. Lo stato era già condiviso nello store; a mancare
 * era solo la memoria di averlo già chiesto.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useChats } from '../useChats';
import { resetStore, testUser } from '../../test/helpers';
import api from '../../services/api';

vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }
}));

const mockedApi = vi.mocked(api);

/** Due componenti indipendenti che usano l'hook, come nell'applicazione vera. */
function Consumer({ label }: { label: string }) {
  const { chats, status } = useChats();
  return <div data-testid={label}>{status}:{chats.length}</div>;
}

describe('useChats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.get.mockResolvedValue({ data: [] });
  });

  it('con due componenti montati insieme chiama GET /chats una volta sola', async () => {
    resetStore({ user: testUser() });

    render(
      <>
        <Consumer label="barra" />
        <Consumer label="pagina" />
      </>
    );

    await waitFor(() => {
      expect(mockedApi.get.mock.calls.filter(([url]) => url === '/chats')).toHaveLength(1);
    });
  });

  it('un ricaricamento esplicito chiede comunque al server', async () => {
    // La deduplica non deve trasformarsi in una cache: dopo aver eliminato un
    // personaggio o inviato un messaggio la cronologia va riletta davvero.
    resetStore({ user: testUser() });

    // Il ricaricamento si scatena da un click, non assegnando l'hook a una
    // variabile esterna durante il render: farlo sarebbe un effetto collaterale
    // dentro il render, cioè esattamente ciò che React vieta.
    function WithReload() {
      const { reload } = useChats();
      return <button onClick={() => reload()}>ricarica</button>;
    }

    render(<WithReload />);
    await waitFor(() => {
      expect(mockedApi.get.mock.calls.filter(([url]) => url === '/chats')).toHaveLength(1);
    });

    await userEvent.click(screen.getByRole('button', { name: 'ricarica' }));
    await waitFor(() => {
      expect(mockedApi.get.mock.calls.filter(([url]) => url === '/chats')).toHaveLength(2);
    });
  });

  it('cambiando utente la cronologia viene richiesta di nuovo', async () => {
    // Altrimenti chi accede dopo un logout vedrebbe le conversazioni di prima.
    resetStore({ user: testUser({ id: 'u1' }) });
    const view = render(<Consumer label="barra" />);
    await waitFor(() => {
      expect(mockedApi.get.mock.calls.filter(([url]) => url === '/chats')).toHaveLength(1);
    });

    resetStore({ user: testUser({ id: 'u2', username: 'bruno' }) });
    view.rerender(<Consumer label="barra" />);

    await waitFor(() => {
      expect(mockedApi.get.mock.calls.filter(([url]) => url === '/chats')).toHaveLength(2);
    });
  });
});
