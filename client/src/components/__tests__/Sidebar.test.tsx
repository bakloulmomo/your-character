/**
 * FASE E — Barra laterale: ricerca e cronologia.
 *
 * Sono le due correzioni più visibili della FASE C, ed entrambe erano rotte
 * nello stesso modo: esistevano nell'interfaccia e non erano collegate a nulla.
 * La ricerca non filtrava (S3-1), la cronologia non esisteva affatto (S3-6) e
 * `GET /chats` non veniva mai chiamato dal client (S3-4).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import Sidebar from '../Sidebar';
import { resetStore, testUser, testCharacter } from '../../test/helpers';
import api from '../../services/api';

vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }
}));

const mockedApi = vi.mocked(api);

/** Mostra l'indirizzo corrente, così i test verificano dove si è finiti davvero. */
function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

const renderSidebar = (route = '/') =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <Sidebar />
      <LocationDisplay />
      <Routes>
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>
  );

const chatFixture = (id: string, hoursAgo = 1) => ({
  _id: id,
  title: `Chat ${id}`,
  characterId: testCharacter({ _id: `char-${id}`, name: `Personaggio ${id}` }),
  messageCount: 4,
  lastMessageAt: new Date(Date.now() - hoursAgo * 3600_000).toISOString()
});

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.get.mockResolvedValue({ data: [] });
  });

  describe('ricerca (S3-1)', () => {
    it('porta a un indirizzo condivisibile con il termine cercato', async () => {
      resetStore({ user: testUser() });
      renderSidebar();

      await userEvent.type(screen.getByLabelText('Cerca personaggi'), 'marcus{Enter}');

      await waitFor(() => {
        expect(screen.getByTestId('location')).toHaveTextContent('/search?q=marcus');
      });
    });

    it('codifica i caratteri speciali invece di produrre un indirizzo rotto', async () => {
      resetStore({ user: testUser() });
      renderSidebar();

      await userEvent.type(screen.getByLabelText('Cerca personaggi'), 'a&b c{Enter}');

      await waitFor(() => {
        expect(screen.getByTestId('location')).toHaveTextContent('/search?q=a%26b%20c');
      });
    });

    it('una ricerca vuota apre comunque la pagina, senza termine', async () => {
      resetStore({ user: testUser() });
      renderSidebar();

      await userEvent.type(screen.getByLabelText('Cerca personaggi'), '   {Enter}');

      await waitFor(() => {
        expect(screen.getByTestId('location')).toHaveTextContent('/search');
      });
    });
  });

  describe('cronologia (S3-6, S3-4)', () => {
    it('chiama davvero GET /chats: era la rotta che il client non usava mai', async () => {
      resetStore({ user: testUser() });
      renderSidebar();
      await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith('/chats'));
    });

    it('elenca le conversazioni raggruppate per data', async () => {
      mockedApi.get.mockResolvedValue({ data: [chatFixture('a', 1), chatFixture('b', 30)] });
      resetStore({ user: testUser() });
      renderSidebar();

      expect(await screen.findByText('Oggi')).toBeInTheDocument();
      expect(await screen.findByText('Ieri')).toBeInTheDocument();
      expect(await screen.findByText('Personaggio a')).toBeInTheDocument();
    });

    it('ogni conversazione è un link riapribile', async () => {
      mockedApi.get.mockResolvedValue({ data: [chatFixture('xyz')] });
      resetStore({ user: testUser() });
      renderSidebar();

      const link = await screen.findByRole('link', { name: /Personaggio xyz/ });
      expect(link).toHaveAttribute('href', '/chat/xyz');
    });

    it('senza conversazioni lo dice, invece di mostrare il vuoto', async () => {
      resetStore({ user: testUser() });
      renderSidebar();
      expect(await screen.findByText(/Nessuna conversazione/i)).toBeInTheDocument();
    });

    /**
     * La cronologia oltre la prima pagina.
     *
     * Il server manda le trenta conversazioni più recenti e il seguito in
     * `X-Has-More` / `X-Next-Cursor`. Finché il client non li leggeva, chi ne
     * aveva più di trenta non poteva più raggiungere le altre: esistevano,
     * erano ordinate, ed erano irraggiungibili dall'interfaccia.
     */
    it('offre «carica altre» solo quando ce ne sono davvero', async () => {
      mockedApi.get.mockResolvedValue({ data: [chatFixture('a')] });
      resetStore({ user: testUser() });
      renderSidebar();

      await screen.findByText('Personaggio a');
      expect(screen.queryByRole('button', { name: /Carica altre/i })).not.toBeInTheDocument();
    });

    it('carica la pagina successiva e la accoda', async () => {
      mockedApi.get.mockResolvedValueOnce({
        data: [chatFixture('primo')],
        headers: { 'x-has-more': 'true', 'x-next-cursor': '2026-09-01T00:00:00.000Z' }
      });
      resetStore({ user: testUser() });
      renderSidebar();

      const altre = await screen.findByRole('button', { name: /Carica altre/i });

      mockedApi.get.mockResolvedValueOnce({
        data: [chatFixture('secondo')],
        headers: { 'x-has-more': 'false' }
      });
      await userEvent.click(altre);

      expect(await screen.findByText('Personaggio secondo')).toBeInTheDocument();
      // Il primo resta: si accoda, non si sostituisce.
      expect(screen.getByText('Personaggio primo')).toBeInTheDocument();
      // E il comando sparisce quando la lista è finita.
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: /Carica altre/i })).not.toBeInTheDocument()
      );
    });

    it('una risposta senza intestazioni non blocca la cronologia', async () => {
      // Un proxy che filtra le intestazioni, o uno strato di rete finto: la
      // lista deve comparire lo stesso, senza il comando di continuazione.
      mockedApi.get.mockResolvedValue({ data: [chatFixture('solo')] });
      resetStore({ user: testUser() });
      renderSidebar();

      expect(await screen.findByText('Personaggio solo')).toBeInTheDocument();
    });

    it('a un visitatore anonimo propone di accedere', async () => {
      resetStore({ user: null });
      renderSidebar();
      expect(await screen.findByText(/per ritrovare qui le tue conversazioni/i)).toBeInTheDocument();
    });
  });

  describe('accesso alla moderazione', () => {
    it('non compare a un utente comune', async () => {
      resetStore({ user: testUser({ role: 'user' }) });
      renderSidebar();
      expect(screen.queryByRole('link', { name: 'Moderazione' })).not.toBeInTheDocument();
    });

    it('compare a un moderatore', async () => {
      resetStore({ user: testUser({ role: 'moderator' }) });
      renderSidebar();
      expect(await screen.findByRole('link', { name: 'Moderazione' })).toBeInTheDocument();
    });
  });
});
