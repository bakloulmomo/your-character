/**
 * FASE E — Banner dei cookie (S2-6).
 *
 * Il difetto originale non era estetico: la scelta veniva scritta nel
 * localStorage e non letta da nessuno, la "X" equivaleva ad accettare e dopo la
 * prima volta non era più modificabile. Questi test bloccano proprio quelle tre
 * proprietà — che rifiutare sia possibile e altrettanto semplice, che la scelta
 * governi qualcosa, e che venga registrata sull'account.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CookieBanner from '../CookieBanner';
import { renderWithRouter, resetStore, testUser } from '../../test/helpers';
import { hasFunctionalConsent, needsDecision } from '../../lib/consent';
import api from '../../services/api';

vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn().mockResolvedValue({ data: {} }), delete: vi.fn() }
}));

const mockedApi = vi.mocked(api);

describe('CookieBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.patch.mockResolvedValue({ data: {} });
    localStorage.clear();
    // Il banner con la SCELTA esiste solo quando c'e' davvero uno script di
    // terze parti su cui esprimersi, cioe' quando i pagamenti sono accesi.
    // Durante la beta restano solo i cookie tecnici e l'avviso e' informativo.
    resetStore({ features: { payments: true, subscriptions: false, imageGeneration: false } });
  });

  describe('durante la beta, senza pagamenti attivi', () => {
    beforeEach(() => {
      resetStore({ features: { payments: false, subscriptions: false, imageGeneration: false } });
    });

    it('non chiede un consenso per Stripe, che non viene mai caricato', async () => {
      renderWithRouter(<CookieBanner />);
      await screen.findByRole('region', { name: /informativa cookie/i });
      expect(screen.queryByRole('button', { name: /consenti anche stripe/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /ho capito/i })).toBeInTheDocument();
    });

    it('informa e basta: i cookie tecnici non richiedono un consenso', async () => {
      renderWithRouter(<CookieBanner />);
      const avviso = await screen.findByRole('region', { name: /informativa cookie/i });
      expect(avviso).toHaveTextContent(/solo cookie tecnici/i);
    });

    it('la conferma registra la scelta e chiude l avviso', async () => {
      renderWithRouter(<CookieBanner />);
      await userEvent.click(await screen.findByRole('button', { name: /ho capito/i }));

      await waitFor(() =>
        expect(screen.queryByRole('region', { name: /informativa cookie/i })).not.toBeInTheDocument()
      );
      expect(needsDecision()).toBe(false);
      expect(hasFunctionalConsent()).toBe(false);
    });
  });

  it('compare quando non è mai stata fatta una scelta', async () => {
    renderWithRouter(<CookieBanner />);
    expect(await screen.findByRole('region', { name: /informativa cookie/i })).toBeInTheDocument();
  });

  it('rifiutare costa un click quanto accettare: nessuna "X" che vale come consenso', async () => {
    renderWithRouter(<CookieBanner />);
    await screen.findByRole('region', { name: /informativa cookie/i });

    expect(screen.getByRole('button', { name: /solo tecnici/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /consenti anche stripe/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^chiudi$/i })).not.toBeInTheDocument();
  });

  it('il rifiuto è registrato come scelta e blocca il caricamento anticipato', async () => {
    renderWithRouter(<CookieBanner />);
    await userEvent.click(await screen.findByRole('button', { name: /solo tecnici/i }));

    expect(needsDecision()).toBe(false);
    expect(hasFunctionalConsent()).toBe(false);
  });

  it('il consenso abilita il caricamento anticipato', async () => {
    renderWithRouter(<CookieBanner />);
    await userEvent.click(await screen.findByRole('button', { name: /consenti anche stripe/i }));

    expect(hasFunctionalConsent()).toBe(true);
  });

  it('per un utente autenticato la scelta viene registrata anche sull\'account', async () => {
    // Il GDPR chiede di poter DIMOSTRARE il consenso: nel solo localStorage
    // non è dimostrabile e si perde a ogni cambio di dispositivo.
    resetStore({ user: testUser(), features: { payments: true, subscriptions: false, imageGeneration: false } });
    renderWithRouter(<CookieBanner />);
    await userEvent.click(await screen.findByRole('button', { name: /solo tecnici/i }));

    await waitFor(() => {
      expect(mockedApi.patch).toHaveBeenCalledWith('/users/me/preferences', {
        cookieConsent: expect.objectContaining({ functional: false })
      });
    });
  });

  it('un errore di rete non fa ripresentare il banner all\'infinito', async () => {
    resetStore({ user: testUser(), features: { payments: true, subscriptions: false, imageGeneration: false } });
    mockedApi.patch.mockRejectedValue(new Error('rete assente'));

    renderWithRouter(<CookieBanner />);
    await userEvent.click(await screen.findByRole('button', { name: /solo tecnici/i }));

    await waitFor(() => expect(needsDecision()).toBe(false));
  });

  it('non compare a chi ha già scelto sulla versione corrente', async () => {
    renderWithRouter(<CookieBanner />);
    await userEvent.click(await screen.findByRole('button', { name: /solo tecnici/i }));

    renderWithRouter(<CookieBanner />);
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.queryByRole('region', { name: /informativa cookie/i })).not.toBeInTheDocument();
  });
});
