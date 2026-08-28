/**
 * FASE E — Rendering di un messaggio.
 *
 * Copre due correzioni che senza un test si perderebbero in silenzio:
 * S3-15 (azioni narrative in corsivo, a-capo preservati) e la distinzione
 * introdotta in FASE D fra le parole del personaggio e un avviso della
 * piattaforma — un messaggio di crisi mostrato come battuta del personaggio
 * sarebbe peggio che non mostrarlo affatto.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageBubble from '../MessageBubble';
import { testCharacter } from '../../test/helpers';
import type { Message } from '../../store/useStore';

const message = (overrides: Partial<Message> = {}): Message => ({
  _id: 'm1',
  chatId: 'chat1',
  role: 'assistant',
  content: 'Ciao!',
  createdAt: new Date().toISOString(),
  ...overrides
});

const character = testCharacter();

describe('MessageBubble', () => {
  it('rende in corsivo le azioni narrative fra asterischi', () => {
    render(<MessageBubble message={message({ content: '*sorride* Come stai?' })} character={character} isLast />);

    const em = screen.getByText('sorride');
    expect(em.tagName).toBe('EM');
    expect(screen.getByText(/Come stai\?/)).toBeInTheDocument();
  });

  it('etichetta le risposte simulate come non addebitate', () => {
    render(<MessageBubble message={message({ simulated: true })} character={character} isLast />);
    expect(screen.getByText(/nessun credito addebitato/i)).toBeInTheDocument();
  });

  it('un avviso di sicurezza è attribuito alla piattaforma, non al personaggio', () => {
    render(<MessageBubble message={message({ safetyNotice: true, content: 'Telefono Amico: 02 2327 2327' })} character={character} isLast />);

    expect(screen.getByText(/Messaggio di your-character, non del personaggio/i)).toBeInTheDocument();
    // L'avatar del personaggio non compare: quelle non sono sue parole.
    expect(screen.queryByAltText(character.name)).not.toBeInTheDocument();
  });

  it('un avviso di sicurezza non si può rigenerare né segnalare', () => {
    // Rigenerarlo significherebbe poter ritentare finché il filtro non cede.
    render(
      <MessageBubble
        message={message({ safetyNotice: true })}
        character={character}
        isLast
        onRegenerate={vi.fn()}
        onReport={vi.fn()}
      />
    );

    expect(screen.queryByLabelText('Rigenera risposta')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Segnala messaggio')).not.toBeInTheDocument();
  });

  it('una risposta normale offre rigenerazione e segnalazione', () => {
    render(<MessageBubble message={message()} character={character} isLast onRegenerate={vi.fn()} onReport={vi.fn()} />);
    expect(screen.getByLabelText('Rigenera risposta')).toBeInTheDocument();
    expect(screen.getByLabelText('Segnala messaggio')).toBeInTheDocument();
  });

  it('la rigenerazione è offerta solo sull\'ultimo messaggio', () => {
    render(<MessageBubble message={message()} character={character} isLast={false} onRegenerate={vi.fn()} />);
    expect(screen.queryByLabelText('Rigenera risposta')).not.toBeInTheDocument();
  });

  it('segnalare un messaggio passa il suo identificativo', async () => {
    const onReport = vi.fn();
    render(<MessageBubble message={message({ _id: 'm42' })} character={character} isLast onReport={onReport} />);

    await userEvent.click(screen.getByLabelText('Segnala messaggio'));
    expect(onReport).toHaveBeenCalledWith('m42');
  });

  it('un errore di generazione è mostrato come tale', () => {
    render(<MessageBubble message={message({ error: true })} character={character} isLast />);
    expect(screen.getByText(/Risposta non riuscita/i)).toBeInTheDocument();
  });
});
