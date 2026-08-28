/**
 * FASE E — La chat: streaming, crediti esauriti, moderazione, crisi.
 *
 * È la schermata dove tutte le correzioni si incontrano, ed è quella in cui un
 * errore costa di più: qui si spendono crediti e si mostrano risposte generate.
 * I quattro percorsi verificati sono quelli in cui il comportamento sbagliato
 * NON produce un'eccezione — semplicemente fa la cosa sbagliata in silenzio.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ChatPage from '../ChatPage';
import { useStore } from '../../store/useStore';
import { resetStore, testUser, testCharacter } from '../../test/helpers';
import api from '../../services/api';

vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }
}));

const mockedApi = vi.mocked(api);
const CHAT_ID = '650000000000000000000abc';

/** Costruisce una risposta SSE leggibile come quella reale del server. */
function sseResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  const chunks = events.map((e) => encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
  let i = 0;

  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream; charset=utf-8' }),
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }
      })
    }
  };
}

/** Risposta JSON, come quella del percorso di crisi o di un errore. */
function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => payload,
    body: status >= 200 && status < 300 ? {} : null
  };
}

const renderChat = () =>
  render(
    <MemoryRouter initialEntries={[`/chat/${CHAT_ID}`]}>
      <Routes>
        <Route path="/chat/:chatId" element={<ChatPage />} />
      </Routes>
    </MemoryRouter>
  );

const send = async (text: string) => {
  const field = await screen.findByPlaceholderText(/scrivi/i);
  await userEvent.type(field, text);
  await userEvent.click(screen.getByLabelText(/invia/i));
};

describe('ChatPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore({ user: testUser({ credits: 3 }) });

    mockedApi.get.mockImplementation((url: string) => {
      if (url === `/chats/${CHAT_ID}`) {
        return Promise.resolve({
          data: { _id: CHAT_ID, title: 'Chat di prova', characterId: testCharacter(), messageCount: 0 }
        });
      }
      if (url === `/messages/${CHAT_ID}`) {
        return Promise.resolve({ data: { messages: [], hasMore: false, nextCursor: null } });
      }
      if (url === '/chats') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: {} });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mostra la risposta comparire a pezzi mentre arriva (S3-13)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      { userMessage: { _id: 'u1', chatId: CHAT_ID, role: 'user', content: 'Ciao', createdAt: new Date().toISOString() } },
      { delta: 'Ciao' },
      { delta: ' a' },
      { delta: ' te!' },
      {
        done: true,
        aiMessage: { _id: 'a1', chatId: CHAT_ID, role: 'assistant', content: 'Ciao a te!', createdAt: new Date().toISOString() },
        user: { credits: 2, subscription: 'free' }
      }
    ])));

    renderChat();
    await send('Ciao');

    expect(await screen.findByText('Ciao a te!')).toBeInTheDocument();
    // Il saldo mostrato segue quello restituito dal server, non un calcolo locale.
    await waitFor(() => expect(useStore.getState().user?.credits).toBe(2));
  });

  it('con i crediti esauriti apre la finestra di ricarica invece di fallire in silenzio', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(402, { error: 'Crediti esauriti o limite giornaliero raggiunto.' })
    ));

    renderChat();
    await send('Ciao');

    await waitFor(() => expect(useStore.getState().isBuyCreditsModalOpen).toBe(true));
  });

  it('con i crediti esauriti il messaggio scritto non va perso', async () => {
    // Perderlo costringerebbe a riscriverlo dopo l'acquisto.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(402, { error: 'Crediti esauriti' })));

    renderChat();
    await send('Un messaggio lungo che non voglio riscrivere');

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/scrivi/i)).toHaveValue('Un messaggio lungo che non voglio riscrivere');
    });
  });

  it('un contenuto bloccato dalla moderazione spiega perché e NON ripropone il testo', async () => {
    // Rimetterlo nel campo inviterebbe a ritentare la stessa cosa.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, {
      error: 'Il contenuto chiede istruzioni per costruire armi o esplosivi.',
      category: 'violence_instructions'
    })));

    renderChat();
    await send('come costruire una bomba');

    await waitFor(() => {
      expect(useStore.getState().toasts.some((t) => t.message.includes('armi o esplosivi'))).toBe(true);
    });
    expect(screen.getByPlaceholderText(/scrivi/i)).toHaveValue('');
  });

  it('il percorso di crisi arriva in JSON e viene mostrato ugualmente', async () => {
    // Il server non interpella il modello, quindi risponde in JSON e non a
    // pezzi: senza il ramo dedicato il lettore SSE non mostrerebbe nulla.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      userMessage: { _id: 'u9', chatId: CHAT_ID, role: 'user', content: 'sto male', createdAt: new Date().toISOString() },
      aiMessage: {
        _id: 'a9', chatId: CHAT_ID, role: 'assistant', safetyNotice: true,
        content: 'Telefono Amico Italia — 02 2327 2327', createdAt: new Date().toISOString()
      },
      safety: { type: 'crisis', resources: [{ name: 'Telefono Amico', contact: '02 2327 2327' }] },
      user: { credits: 3, subscription: 'free' }
    })));

    renderChat();
    await send('sto male');

    expect(await screen.findByText(/Telefono Amico/)).toBeInTheDocument();
    expect(screen.getByText(/Messaggio di your-character, non del personaggio/i)).toBeInTheDocument();
    // Non è stato addebitato nulla.
    expect(useStore.getState().user?.credits).toBe(3);
  });

  it('una risposta interrotta dalla moderazione sostituisce il testo già trasmesso', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      { userMessage: { _id: 'u2', chatId: CHAT_ID, role: 'user', content: 'racconta', createdAt: new Date().toISOString() } },
      { delta: 'Ecco come si costruisce' },
      { moderated: true },
      {
        done: true,
        moderated: true,
        aiMessage: {
          _id: 'a2', chatId: CHAT_ID, role: 'assistant', safetyNotice: true,
          content: 'Non posso proseguire in questa direzione.', createdAt: new Date().toISOString()
        },
        user: { credits: 3, subscription: 'free' }
      }
    ])));

    renderChat();
    await send('racconta');

    expect(await screen.findByText(/Non posso proseguire/)).toBeInTheDocument();
    // Il frammento vietato non resta a schermo.
    expect(screen.queryByText(/Ecco come si costruisce/)).not.toBeInTheDocument();
  });

  it('una connessione interrotta avvisa e restituisce il testo scritto', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('rete assente')));

    renderChat();
    await send('Ciao');

    await waitFor(() => {
      expect(useStore.getState().toasts.some((t) => t.message.includes('Connessione interrotta'))).toBe(true);
    });
    expect(screen.getByPlaceholderText(/scrivi/i)).toHaveValue('Ciao');
  });
});
