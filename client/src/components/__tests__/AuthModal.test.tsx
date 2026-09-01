/**
 * Il modulo di accesso e registrazione.
 *
 * Il primo test di questo file riproduce un difetto che rendeva il prodotto
 * inutilizzabile senza che nessuna suite se ne accorgesse: al primo carattere
 * digitato il campo perdeva il fuoco e il cursore saltava sulla «X» di
 * chiusura. Il resto dei test copre le altre superfici del modulo — validazione
 * istantanea, stati di caricamento, data di nascita, accessibilita' — perche'
 * un difetto di fuoco corretto e non protetto e' un difetto che torna.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AuthModal from '../AuthModal';
import { resetStore } from '../../test/helpers';
import api from '../../services/api';

/**
 * `setAuthToken` e' un export NOMINATO di `services/api`, e lo store lo chiama
 * dentro `setToken`. Un mock che dichiari solo il `default` lo lascia
 * `undefined`: la chiamata lancia un TypeError che finisce nel `catch` del
 * modulo, e il test vede «Registrazione non riuscita» su una richiesta andata
 * a buon fine. Il finto deve avere la stessa superficie del vero.
 */
vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  setAuthToken: vi.fn()
}));

const mockedApi = vi.mocked(api);

const mount = () => render(<MemoryRouter><AuthModal /></MemoryRouter>);

beforeEach(() => {
  resetStore({ isAuthModalOpen: true, authModalMode: 'login' });
  vi.clearAllMocks();
});

describe('fuoco della tastiera', () => {
  /**
   * IL DIFETTO.
   *
   * `Modal` teneva in un solo `useEffect` — con `onClose` fra le dipendenze —
   * sia la trappola del fuoco sia il fuoco iniziale. `onClose` era una funzione
   * ricreata a ogni render di `AuthModal`, quindi ogni battuta di tasto
   * cambiava l'identita' della dipendenza: React smontava l'effetto (e la sua
   * pulizia rimetteva il fuoco sull'elemento di partenza) e lo rimontava,
   * spostando il fuoco sul PRIMO elemento focalizzabile del pannello — che
   * nell'ordine del DOM e' il pulsante di chiusura.
   */
  it('il campo email conserva il fuoco mentre si digita', async () => {
    const user = userEvent.setup();
    mount();

    const email = screen.getByLabelText('Email');
    await user.click(email);
    await user.type(email, 'anna@example.com');

    expect(email).toHaveFocus();
    expect(email).toHaveValue('anna@example.com');
  });

  it('il campo password conserva il fuoco mentre si digita', async () => {
    const user = userEvent.setup();
    mount();

    const password = screen.getByLabelText('Password', { exact: true });
    await user.click(password);
    await user.type(password, 'Password1');

    expect(password).toHaveFocus();
    expect(password).toHaveValue('Password1');
  });

  it('il fuoco iniziale va al primo campo, non al pulsante di chiusura', async () => {
    mount();
    await waitFor(() => expect(screen.getByLabelText('Email')).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Chiudi' })).not.toHaveFocus();
  });

  it('mostrare la password non fa perdere il punto di inserimento', async () => {
    const user = userEvent.setup();
    mount();

    const password = screen.getByLabelText('Password', { exact: true });
    await user.type(password, 'Password1');
    await user.click(screen.getByRole('button', { name: 'Mostra password' }));

    expect(screen.getByLabelText('Password', { exact: true })).toHaveFocus();
  });
});

describe('validazione istantanea', () => {
  it('segnala un indirizzo non valido solo dopo che il campo e\' stato lasciato', async () => {
    const user = userEvent.setup();
    mount();

    const email = screen.getByLabelText('Email');
    await user.type(email, 'non-un-indirizzo');
    // Mentre si digita non si accusa nessuno: l'errore comparirebbe alla prima
    // lettera, quando l'indirizzo e' incompleto per forza.
    expect(screen.queryByText(/indirizzo email non valido/i)).not.toBeInTheDocument();

    await user.tab();
    expect(await screen.findByText(/indirizzo email non valido/i)).toBeInTheDocument();
    expect(email).toHaveAttribute('aria-invalid', 'true');
  });

  it('l\'errore sparisce appena l\'indirizzo diventa valido', async () => {
    const user = userEvent.setup();
    mount();

    const email = screen.getByLabelText('Email');
    await user.type(email, 'non-un-indirizzo');
    await user.tab();
    expect(await screen.findByText(/indirizzo email non valido/i)).toBeInTheDocument();

    await user.click(email);
    await user.type(email, '@example.com');
    await waitFor(() =>
      expect(screen.queryByText(/indirizzo email non valido/i)).not.toBeInTheDocument()
    );
  });

  it('i requisiti della password si aggiornano a ogni carattere e sono annunciati', async () => {
    const user = userEvent.setup();
    resetStore({ isAuthModalOpen: true, authModalMode: 'register' });
    mount();

    const requisiti = screen.getByRole('status', { name: /requisiti della password/i });
    expect(requisiti).toHaveAttribute('aria-live', 'polite');

    const password = screen.getByLabelText('Password', { exact: true });
    await user.type(password, 'abcdefgh');

    // Otto caratteri: lunghezza soddisfatta, maiuscola e numero no.
    expect(screen.getByText('Almeno 8 caratteri').closest('li')).toHaveAttribute('data-ok', 'true');
    expect(screen.getByText('Una lettera maiuscola').closest('li')).toHaveAttribute('data-ok', 'false');
  });
});

describe('stati di caricamento', () => {
  it('il pulsante Accedi si disabilita e si annuncia occupato durante la chiamata', async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    mockedApi.post.mockReturnValueOnce(new Promise((r) => { resolve = r; }) as never);

    mount();
    await user.type(screen.getByLabelText('Email'), 'anna@example.com');
    await user.type(screen.getByLabelText('Password', { exact: true }), 'Password1');

    const submit = screen.getByRole('button', { name: /accedi/i });
    await user.click(submit);

    await waitFor(() => expect(submit).toBeDisabled());
    expect(submit).toHaveAttribute('aria-busy', 'true');

    resolve({ data: { token: 't', user: { username: 'anna', credits: 100 } } });
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
  });

  it('un doppio clic non invia due volte la richiesta', async () => {
    const user = userEvent.setup();
    mockedApi.post.mockReturnValueOnce(new Promise(() => {}) as never);

    mount();
    await user.type(screen.getByLabelText('Email'), 'anna@example.com');
    await user.type(screen.getByLabelText('Password', { exact: true }), 'Password1');

    const submit = screen.getByRole('button', { name: /accedi/i });
    await user.click(submit);
    await user.click(submit);

    expect(mockedApi.post).toHaveBeenCalledTimes(1);
  });
});

describe('data di nascita', () => {
  it('il numero di giorni segue il mese scelto', async () => {
    const user = userEvent.setup();
    resetStore({ isAuthModalOpen: true, authModalMode: 'register' });
    mount();

    await user.selectOptions(screen.getByLabelText('Anno'), '1995');
    // Febbraio 1995: 28 giorni, il 29 non deve nemmeno essere offerto.
    await user.selectOptions(screen.getByLabelText('Mese'), '1');
    expect(screen.queryByRole('option', { name: '29' })).not.toBeInTheDocument();

    // Gennaio: 31.
    await user.selectOptions(screen.getByLabelText('Mese'), '0');
    expect(screen.getByRole('option', { name: '31' })).toBeInTheDocument();
  });

  it('un giorno non piu\' valido viene corretto invece di restare selezionato', async () => {
    const user = userEvent.setup();
    resetStore({ isAuthModalOpen: true, authModalMode: 'register' });
    mount();

    await user.selectOptions(screen.getByLabelText('Anno'), '1995');
    await user.selectOptions(screen.getByLabelText('Mese'), '0');
    await user.selectOptions(screen.getByLabelText('Giorno'), '31');
    expect(screen.getByLabelText('Giorno')).toHaveValue('31');

    await user.selectOptions(screen.getByLabelText('Mese'), '1');
    await waitFor(() => expect(screen.getByLabelText('Giorno')).not.toHaveValue('31'));
  });
});

describe('accessibilita\' e struttura', () => {
  it('il selettore Accedi/Registrati si comanda con le frecce', async () => {
    const user = userEvent.setup();
    mount();

    const accedi = screen.getByRole('tab', { name: 'Accedi' });
    const registrati = screen.getByRole('tab', { name: 'Registrati' });

    expect(accedi).toHaveAttribute('aria-selected', 'true');
    expect(registrati).toHaveAttribute('tabindex', '-1');

    accedi.focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: 'Registrati' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Registrati' })).toHaveFocus();
  });

  it('il pannello del modulo e\' collegato al selettore', () => {
    mount();
    const tab = screen.getByRole('tab', { name: 'Accedi' });
    const panel = screen.getByRole('tabpanel');
    expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
  });

  it('il dialogo e\' etichettato dal proprio titolo visibile', () => {
    mount();
    const dialog = screen.getByRole('dialog');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)).toHaveTextContent('Accedi');
  });

  it('trascinare la selezione fuori dal pannello non chiude il modale', async () => {
    const user = userEvent.setup();
    mount();

    const email = screen.getByLabelText('Email');
    const overlay = screen.getByTestId('modal-overlay');

    // Premuto dentro, rilasciato fuori: e' il gesto di chi seleziona il testo
    // di un campo e finisce oltre il bordo. Non deve buttare via il modulo.
    await user.pointer([
      { keys: '[MouseLeft>]', target: email },
      { target: overlay },
      { keys: '[/MouseLeft]', target: overlay }
    ]);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('correttezza dei messaggi', () => {
  it('il saldo annunciato dopo la registrazione e\' quello che il server ha davvero assegnato', async () => {
    const user = userEvent.setup();
    resetStore({ isAuthModalOpen: true, authModalMode: 'register' });
    // In beta gratuita `welcomeCredits()` vale 100, non 10.
    mockedApi.post.mockResolvedValueOnce({
      data: { token: 't', user: { username: 'anna', credits: 100 } }
    } as never);

    mount();
    await user.type(screen.getByLabelText('Email'), 'anna@example.com');
    await user.type(screen.getByLabelText('Nome utente'), 'anna');
    await user.type(screen.getByLabelText('Password', { exact: true }), 'Password1');
    await user.selectOptions(screen.getByLabelText('Anno'), '1995');
    await user.selectOptions(screen.getByLabelText('Mese'), '2');
    await user.selectOptions(screen.getByLabelText('Giorno'), '14');
    await user.click(screen.getByRole('button', { name: /crea account/i }));

    const { useStore } = await import('../../store/useStore');
    await waitFor(() => {
      const toast = useStore.getState().toasts.at(-1);
      expect(toast?.message).toContain('100 crediti');
    });
  });
});
