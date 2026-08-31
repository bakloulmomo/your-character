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

/**
 * Risposta SSE che si ferma finché il test non la lascia proseguire.
 *
 * Serve a osservare l'attesa: con una risposta immediata la fase «richiesta
 * partita, primo pezzo non ancora arrivato» dura meno di un fotogramma e non è
 * verificabile.
 */
function pausedSseResponse() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode(`data: ${JSON.stringify({ delta: 'Eccomi' })}\n\n`),
    encoder.encode(`data: ${JSON.stringify({
      done: true,
      aiMessage: { _id: 'a3', chatId: CHAT_ID, role: 'assistant', content: 'Eccomi', createdAt: new Date().toISOString() },
      user: { credits: 2, subscription: 'free' }
    })}\n\n`)
  ];
  let i = 0;

  return {
    release,
    response: {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream; charset=utf-8' }),
      body: {
        getReader: () => ({
          read: async () => {
            await gate;
            return i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined };
          }
        })
      }
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

  it("durante l'attesa mostra l'indicatore di scrittura e NON una bolla vuota", async () => {
    /**
     * La bolla del testo in arrivo compariva già a contenuto vuoto, perché la
     * condizione era «`streamingText` non è null» e all'avvio dello streaming
     * quel valore è la stringa vuota. Sullo schermo restavano insieme una bolla
     * vuota con il cursore lampeggiante E, sotto, i tre puntini: due modi
     * contemporanei di dire la stessa cosa, uno dei quali senza contenuto.
     */
    const { release, response } = pausedSseResponse();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const { container } = renderChat();
    await send('Ciao');

    // Attesa in corso: c'è l'indicatore…
    expect(await screen.findByRole('status', { name: /sta scrivendo/i })).toBeInTheDocument();
    // …e l'unico orario a schermo è quello del messaggio appena inviato.
    // Con la bolla vuota ce ne sarebbero due.
    expect(container.querySelectorAll('time')).toHaveLength(1);

    // Sbloccata la risposta, la bolla vuota lascia il posto al testo vero e
    // l'indicatore sparisce.
    release();
    await waitFor(() => expect(screen.getByText('Eccomi')).toBeInTheDocument());
    expect(screen.queryByRole('status', { name: /sta scrivendo/i })).not.toBeInTheDocument();
  });

  it('con i crediti esauriti E i pagamenti attivi apre la finestra di ricarica', async () => {
    // I pagamenti sono spenti per difetto (beta gratuita): qui si verifica il
    // comportamento della fase in cui invece si vende.
    useStore.setState({
      features: { payments: true, subscriptions: false, imageGeneration: false }
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(402, { error: 'Crediti esauriti o limite giornaliero raggiunto.' })
    ));

    renderChat();
    await send('Ciao');

    await waitFor(() => expect(useStore.getState().isBuyCreditsModalOpen).toBe(true));
  });

  it('durante la beta gratuita chiede se vuoi continuare, invece di aprire un listino inesistente', async () => {
    // Con i pagamenti spenti non c'e' niente da comprare, ma c'e' qualcosa da
    // chiedere. E' il momento piu' informativo della beta: chi arriva qui
    // voleva continuare, ed e' il segnale piu' vicino a una disponibilita' a
    // pagare che si possa raccogliere senza chiedere una carta.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(402, { error: 'Crediti esauriti o limite giornaliero raggiunto.' })
    ));

    renderChat();
    await send('Ciao');

    await waitFor(() => expect(useStore.getState().isFeedbackModalOpen).toBe(true));
    expect(useStore.getState().feedbackKind).toBe('wants_more');
    // E soprattutto NON si apre il listino, che porterebbe a un vicolo cieco.
    expect(useStore.getState().isBuyCreditsModalOpen).toBe(false);
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

  it('se il server ha già accettato il messaggio, un guasto NON lo rimette nel campo', async () => {
    /**
     * Il difetto: il ramo `error` dello streaming rimetteva sempre il testo nel
     * campo di scrittura. Ma l'evento `userMessage` arriva PRIMA, e a quel
     * punto il messaggio è già salvato sul server. Chi vedeva il proprio testo
     * ricomparire nel campo concludeva ragionevolmente che non fosse partito e
     * premeva invio di nuovo: la stessa domanda finiva due volte nella
     * conversazione, e la seconda volta pagata.
     */
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      {
        userMessage: {
          _id: 'u5', chatId: CHAT_ID, role: 'user',
          content: 'Una domanda che non voglio ripetere', createdAt: new Date().toISOString()
        }
      },
      { error: 'Il servizio AI non e momentaneamente disponibile.' }
    ])));

    renderChat();
    await send('Una domanda che non voglio ripetere');

    await waitFor(() => {
      expect(useStore.getState().toasts.some((t) => t.message.includes('non e momentaneamente disponibile'))).toBe(true);
    });

    // Il campo resta vuoto…
    expect(screen.getByPlaceholderText(/scrivi/i)).toHaveValue('');
    // …e il messaggio resta a schermo, perché sul server c'è davvero.
    expect(screen.getByText('Una domanda che non voglio ripetere')).toBeInTheDocument();
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
