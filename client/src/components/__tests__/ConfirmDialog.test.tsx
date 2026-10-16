import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfirmDialog from '../ui/ConfirmDialog';
import { useStore } from '../../store/useStore';

/**
 * Il dialogo di conferma.
 *
 * Le due cose che contano non sono l'aspetto ma la RISPOSTA: chi chiama scrive
 * `if (!(await askConfirm(...))) return;`, quindi una promessa che si risolve
 * male — o che non si risolve affatto — o cancella qualcosa che nessuno ha
 * chiesto di cancellare, o lascia l'interfaccia bloccata su un `await` che non
 * torna mai.
 */
describe('ConfirmDialog', () => {
  beforeEach(() => {
    useStore.setState({ confirmRequest: null });
  });

  it('non è montato finché nessuno chiede una conferma', () => {
    render(<ConfirmDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('mostra la domanda e restituisce `true` alla conferma', async () => {
    render(<ConfirmDialog />);

    const risposta = useStore.getState().askConfirm({
      title: 'Sei sicuro di voler eliminare questo messaggio?'
    });

    expect(await screen.findByText('Sei sicuro di voler eliminare questo messaggio?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancella' }));

    expect(await risposta).toBe(true);
    expect(useStore.getState().confirmRequest).toBeNull();
  });

  it('restituisce `false` a chi rinuncia', async () => {
    render(<ConfirmDialog />);
    const risposta = useStore.getState().askConfirm({ title: 'Eliminare?' });

    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'Annulla' }));

    expect(await risposta).toBe(false);
  });

  it('chiudere con Esc equivale a rinunciare, non a confermare', async () => {
    // Il silenzio non può valere come consenso a un'azione che non si annulla.
    render(<ConfirmDialog />);
    const risposta = useStore.getState().askConfirm({ title: 'Eliminare?' });

    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');

    expect(await risposta).toBe(false);
  });

  it('le etichette sono personalizzabili, per le azioni che non cancellano', async () => {
    render(<ConfirmDialog />);
    const risposta = useStore.getState().askConfirm({
      title: 'Vuoi disconnetterti?',
      confirmLabel: 'Disconnetti',
      cancelLabel: 'Resta connesso',
      destructive: false
    });

    await screen.findByRole('dialog');
    expect(screen.getByRole('button', { name: 'Resta connesso' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnetti' }));

    expect(await risposta).toBe(true);
  });

  it('una seconda richiesta chiude la prima con un rifiuto, invece di lasciarla appesa', async () => {
    // Una promessa che non si risolve mai è un `await` che non torna: la
    // funzione che lo attendeva resterebbe ferma per sempre, con il suo stato
    // «in corso» acceso.
    render(<ConfirmDialog />);
    const prima = useStore.getState().askConfirm({ title: 'Prima domanda' });
    const seconda = useStore.getState().askConfirm({ title: 'Seconda domanda' });

    expect(await prima).toBe(false);
    expect(await screen.findByText('Seconda domanda')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancella' }));
    expect(await seconda).toBe(true);
  });
});
