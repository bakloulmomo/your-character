/**
 * La conferma dell'indirizzo, lato interfaccia.
 *
 * Il server rifiuta chi non ha confermato; questi test coprono cio' che
 * l'interfaccia deve fare perche' quel rifiuto non arrivi mai a sorpresa: dire
 * subito che serve un codice, accettarlo come lo si riceve davvero (incollato,
 * non ridigitato), e non far sparire quello che l'utente ha scritto quando
 * sbaglia una cifra.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AuthModal from '../AuthModal';
import EmailVerificationBanner from '../EmailVerificationBanner';
import { resetStore } from '../../test/helpers';
import { useStore } from '../../store/useStore';
import api from '../../services/api';

vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  setAuthToken: vi.fn()
}));

const mockedApi = vi.mocked(api);

const utente = (extra = {}) => ({
  id: 'u1', email: 'tizio@example.com', username: 'tizio',
  credits: 100, subscription: 'free', dailyMessageCount: 0, dailyImageCount: 0,
  ...extra
});

const caselle = () => screen.getAllByRole('textbox', { name: /^Cifra \d$/ });

beforeEach(() => {
  resetStore({ isAuthModalOpen: true, authModalMode: 'verify' });
  vi.clearAllMocks();
  /**
   * Esito positivo per difetto.
   *
   * Sei cifre complete FANNO PARTIRE la conferma da sole — e' il
   * comportamento voluto: chi incolla il codice non deve anche premere un
   * pulsante. Ne segue che ogni test che riempie il campo effettua una
   * chiamata, e senza una risposta simulata quella chiamata restituirebbe
   * `undefined`. I test che vogliono l'errore lo dichiarano da se'.
   */
  mockedApi.post.mockResolvedValue({ data: { user: utente({ emailVerified: true }) } } as never);
});

describe('il campo del codice', () => {
  it('presenta sei caselle, quante sono le cifre', () => {
    render(<MemoryRouter><AuthModal /></MemoryRouter>);
    expect(caselle()).toHaveLength(6);
  });

  /**
   * IL GESTO PIU' COMUNE. Chi riceve un codice per email lo copia: senza
   * gestione dell'incolla si riempirebbe solo la prima casella, e proprio il
   * modo normale di usarlo sarebbe quello rotto.
   */
  it('incollare distribuisce le cifre su tutte le caselle', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AuthModal /></MemoryRouter>);

    await user.click(caselle()[0]);
    // Cinque cifre: con sei la conferma partirebbe da sola e il modale si
    // chiuderebbe, che e' il comportamento voluto ma non quello in esame qui.
    await user.paste('48392');

    expect(caselle().map((c) => (c as HTMLInputElement).value).join('')).toBe('48392');
  });

  it('scarta i caratteri che non sono cifre', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AuthModal /></MemoryRouter>);

    await user.click(caselle()[0]);
    await user.paste('4-8 3a9');

    expect(caselle().map((c) => (c as HTMLInputElement).value).join('')).toBe('4839');
  });

  it('il pulsante di conferma resta spento finché il codice non è completo', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AuthModal /></MemoryRouter>);

    expect(screen.getByRole('button', { name: 'Conferma' })).toBeDisabled();

    await user.click(caselle()[0]);
    await user.paste('12345');

    expect(screen.getByRole('button', { name: 'Conferma' })).toBeDisabled();
  });

  /**
   * La sesta cifra invia da sola: chi incolla un codice non deve anche cercare
   * un pulsante. E' il motivo per cui i test qui sopra si fermano a cinque.
   */
  it('la sesta cifra fa partire la conferma senza premere nulla', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AuthModal /></MemoryRouter>);

    await user.click(caselle()[0]);
    await user.paste('483920');

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith('/auth/verify-email', { code: '483920' });
    });
  });
});

describe('la conferma', () => {
  it('invia il codice e aggiorna l utente', async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValue({ data: { user: utente({ emailVerified: true }) } } as never);
    render(<MemoryRouter><AuthModal /></MemoryRouter>);

    await user.click(caselle()[0]);
    await user.paste('123456');

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith('/auth/verify-email', { code: '123456' });
    });
    await waitFor(() => expect(useStore.getState().user?.emailVerified).toBe(true));
  });

  /**
   * Svuotare il campo dopo un errore trasforma un refuso in un abbandono: chi
   * ha sbagliato una cifra deve poter correggere quella.
   */
  it('un codice errato lascia le cifre dove sono', async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValue({
      response: { status: 400, data: { error: 'Codice non corretto.' } }
    } as never);
    render(<MemoryRouter><AuthModal /></MemoryRouter>);

    await user.click(caselle()[0]);
    await user.paste('111111');

    expect(await screen.findByText('Codice non corretto.')).toBeInTheDocument();
    expect(caselle().map((c) => (c as HTMLInputElement).value).join('')).toBe('111111');
  });

  it('si può rimandare senza restare chiusi fuori', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AuthModal /></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: 'Lo faccio più tardi' }));

    expect(useStore.getState().isAuthModalOpen).toBe(false);
  });
});

describe('la striscia di avviso', () => {
  const monta = () => render(<MemoryRouter><EmailVerificationBanner /></MemoryRouter>);

  it('compare a chi non ha confermato', () => {
    resetStore({ user: utente({ emailVerified: false }), isAuthResolved: true });
    monta();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('non compare a chi ha confermato', () => {
    resetStore({ user: utente({ emailVerified: true }), isAuthResolved: true });
    monta();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('non compare a chi non ha ancora una sessione risolta', () => {
    // Altrimenti sarebbe un rimprovero infondato per il tempo di un caricamento.
    resetStore({ user: utente({ emailVerified: false }), isAuthResolved: false });
    monta();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('non compare a un visitatore anonimo', () => {
    resetStore({ user: null, isAuthResolved: true });
    monta();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('riapre il modale direttamente sulla conferma', async () => {
    const user = userEvent.setup();
    resetStore({ user: utente({ emailVerified: false }), isAuthResolved: true });
    monta();

    await user.click(screen.getByRole('button', { name: 'Inserisci il codice' }));

    expect(useStore.getState().isAuthModalOpen).toBe(true);
    expect(useStore.getState().authModalMode).toBe('verify');
  });
});
