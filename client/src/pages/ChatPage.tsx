import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Send, Image as ImageIcon, ChevronUp, Loader2, MessageSquareOff } from 'lucide-react';
import api from '../services/api';
import { useMessages } from '../hooks/useMessages';
import { useChats } from '../hooks/useChats';
import { useStore, normalizeChat, type Character, type Message } from '../store/useStore';
import MessageBubble from '../components/MessageBubble';
import Avatar from '../components/ui/Avatar';
import Modal from '../components/ui/Modal';
import { EmptyState, ErrorState, Spinner } from '../components/ui/States';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { errorMessage } from '../lib/apiError';

const MAX_LENGTH = 4000;

export default function ChatPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { user, updateCredits, setBuyCreditsModalOpen, setReportModalOpen, notify, features, setFeedbackModalOpen, token } = useStore();
  const { reload: reloadChats } = useChats();
  const { messages, status, hasMore, loadingOlder, loadOlder, setMessages, reload } = useMessages(chatId);

  const [character, setCharacter] = useState<Character | null>(null);
  const [chatTitle, setChatTitle] = useState('');
  const [input, setInput] = useState('');
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);

  /**
   * Crediti esauriti.
   *
   * Con i pagamenti attivi si apre il modale di ricarica. Durante la beta
   * gratuita non c'e' nulla da comprare, quindi aprirlo sarebbe una promessa
   * vuota: si dice com'e'.
   */
  const handleOutOfCredits = () => {
    if (features.payments) {
      setBuyCreditsModalOpen(true);
      return;
    }
    // Durante la beta non c'e' nulla da comprare, ma c'e' qualcosa da
    // chiedere: se vuole continuare. E' il momento piu' informativo di tutta
    // la beta, e lasciarlo passare con un avviso sarebbe uno spreco.
    setFeedbackModalOpen(true, 'wants_more');
  };
  const [imagePrompt, setImagePrompt] = useState('');
  const [generatingImage, setGeneratingImage] = useState(false);

  // Prima di ogni ritorno anticipato: gli hook non possono stare sotto un `if`.
  useDocumentTitle(character?.name ?? (chatTitle || undefined));

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Il personaggio arriva dal dettaglio della chat: un solo tipo normalizzato,
  // così nessuna vista deve indovinare se `characterId` è un id o un documento.
  useEffect(() => {
    if (!chatId) return;
    api
      .get(`/chats/${chatId}`)
      .then((res) => {
        const chat = normalizeChat(res.data);
        setCharacter(chat.character);
        setChatTitle(chat.title);
      })
      .catch(() => setCharacter(null));
  }, [chatId]);

  /**
   * Scorre il contenitore della conversazione, e SOLO quello.
   *
   * `scrollIntoView` è stato sostituito da una scrittura diretta di
   * `scrollTop`. Due ragioni:
   *
   *  · `scrollIntoView` muove ogni antenato scorrevole, non solo il più
   *    vicino: su telefono poteva spostare la pagina intera. È il difetto
   *    S3-16, corretto una volta cambiando `block`, ma la causa restava;
   *  · scrivere `scrollTop = scrollHeight` arriva sempre esattamente in fondo,
   *    mentre `scrollIntoView` si ferma quando l'elemento «entra» nella vista.
   *    Misurato all'apertura di una conversazione lunga: si fermava 31px sopra
   *    il fondo, quindi l'ultima risposta arrivava già tagliata.
   */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    if (status !== 'ready') return;

    /**
     * Due fotogrammi, non uno.
     *
     * Al primo la lista è nel DOM ma il browser non ha ancora terminato il
     * layout definitivo — gli avatar e le bolle a più righe cambiano ancora
     * altezza. Scorrere solo lì lasciava la conversazione poco sopra il fondo.
     */
    const primo = requestAnimationFrame(() => {
      scrollToBottom('auto');
      requestAnimationFrame(() => scrollToBottom('auto'));
    });
    return () => cancelAnimationFrame(primo);
  }, [status, scrollToBottom]);

  useEffect(() => {
    if (streamingText !== null) scrollToBottom();
  }, [streamingText, scrollToBottom]);

  /**
   * Carica i messaggi precedenti tenendo fermo quello che si stava leggendo.
   *
   * Prima i messaggi venivano semplicemente aggiunti in cima: il contenitore
   * cresceva verso l'alto mentre `scrollTop` restava dov'era, quindi la
   * conversazione SALTAVA in avanti di tutta l'altezza appena inserita e si
   * perdeva il punto in cui si era. Misurando l'altezza prima e dopo e
   * riposizionando della differenza, sullo schermo non si muove nulla: compare
   * solo altra conversazione sopra.
   */
  const loadOlderKeepingPosition = useCallback(async () => {
    const el = scrollRef.current;
    const before = el?.scrollHeight ?? 0;
    const previousTop = el?.scrollTop ?? 0;
    await loadOlder();
    requestAnimationFrame(() => {
      if (!el) return;
      el.scrollTop = previousTop + (el.scrollHeight - before);
    });
  }, [loadOlder]);

  // Il campo cresce con il testo, fino a un massimo.
  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };

  useEffect(autoResize, [input]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy || !chatId) return;

    setInput('');
    setBusy(true);
    setStreamingText('');

    const optimistic: Message = {
      _id: `pending_${Date.now()}`,
      chatId,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
      pending: true
    };
    setMessages((prev) => [...prev, optimistic]);
    requestAnimationFrame(() => scrollToBottom());

    /**
     * Il server ha già preso in carico — e salvato — il messaggio.
     *
     * Determina che cosa fare se poi qualcosa fallisce. Finché il messaggio non
     * è stato accettato, un guasto lo restituisce nel campo di scrittura, così
     * non va perso. Una volta accettato NON va restituito: il messaggio è in
     * archivio e resta a schermo, e rimetterlo nel campo faceva credere che non
     * fosse partito — rinviandolo si otteneva la stessa domanda scritta due
     * volte nella conversazione.
     *
     * Dichiarata fuori dal `try` perché la legge anche il `catch` esterno, che
     * gestisce la connessione caduta.
     */
    let accepted = false;

    try {
      // Lo streaming usa `fetch` diretto, quindi non passa dall'interceptor di
      // axios: il token va aggiunto a mano. Viene dallo store, non da
      // localStorage — li' non c'e' piu' nulla da quando la sessione vive nel
      // cookie httpOnly, e questa riga leggeva sempre null. Funzionava solo
      // perche' il cookie viaggia da se', il che rendeva il difetto invisibile.
      const response = await fetch('/api/messages/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ chatId, content: text })
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        setMessages((prev) => prev.filter((m) => m._id !== optimistic._id));
        setStreamingText(null);

        if (response.status === 402) {
          setInput(text);
          handleOutOfCredits();
        } else if (response.status === 429) {
          setInput(text);
          notify(payload.error ?? 'Stai inviando messaggi troppo rapidamente.', 'error');
        } else if (response.status === 400 && payload.category) {
          // Contenuto bloccato dalla moderazione (FASE D). Il testo NON viene
          // rimesso nel campo: riproporlo inviterebbe a ritentare la stessa
          // cosa, e il messaggio spiega già che cosa non è consentito.
          notify(payload.error ?? 'Contenuto non consentito.', 'error');
        } else {
          setInput(text);
          notify(payload.error ?? 'Impossibile inviare il messaggio.', 'error');
        }
        return;
      }

      // Percorso di crisi: il server risponde in JSON invece che a pezzi,
      // perché il modello non viene interpellato affatto. Senza questo ramo il
      // lettore SSE proverebbe a interpretare un corpo JSON e la risposta di
      // aiuto non comparirebbe mai (FASE D).
      if ((response.headers.get('content-type') ?? '').includes('application/json')) {
        const payload = await response.json();
        setStreamingText(null);
        setMessages((prev) =>
          prev
            .map((m) => (m._id === optimistic._id ? payload.userMessage : m))
            .concat(payload.aiMessage ? [payload.aiMessage] : [])
        );
        if (typeof payload.user?.credits === 'number') updateCredits(payload.user.credits);
        reloadChats();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';

        for (const block of blocks) {
          if (!block.startsWith('data: ')) continue;
          const event = JSON.parse(block.slice(6));

          if (event.userMessage) {
            accepted = true;
            setMessages((prev) =>
              prev.map((m) => (m._id === optimistic._id ? event.userMessage : m))
            );
          }
          if (event.delta) {
            accumulated += event.delta;
            setStreamingText(accumulated);
          }
          // La moderazione ha interrotto la risposta a metà: si smette subito
          // di mostrare il testo parziale, che sarà sostituito da quello
          // definitivo nell'evento finale.
          if (event.moderated) {
            accumulated = '';
            setStreamingText('');
          }
          if (event.error) {
            notify(event.error, 'error');
            if (accepted) {
              // Il messaggio è salvato sul server: resta dov'è, e il campo
              // resta vuoto. Ricaricando la pagina lo si ritrova, senza
              // risposta — che è la verità.
              setMessages((prev) => prev.filter((m) => !m.pending));
            } else {
              setMessages((prev) => prev.filter((m) => m._id !== optimistic._id && !m.pending));
              setInput(text);
            }
            // La cronologia va riletta comunque: il server ha aggiornato il
            // conteggio e la data dell'ultimo messaggio anche in caso di guasto.
            reloadChats();
          }
          if (event.done) {
            setMessages((prev) => [...prev, event.aiMessage]);
            if (typeof event.user?.credits === 'number') updateCredits(event.user.credits);
            reloadChats();
          }
        }
      }
    } catch {
      // Connessione caduta. Se il server aveva già confermato il messaggio,
      // dirgli «non è stato inviato» sarebbe falso: è partito, manca la
      // risposta.
      if (accepted) {
        setMessages((prev) => prev.filter((m) => !m.pending));
        notify('Connessione interrotta mentre arrivava la risposta. Il tuo messaggio è stato salvato.', 'error');
      } else {
        setMessages((prev) => prev.filter((m) => m._id !== optimistic._id));
        setInput(text);
        notify('Connessione interrotta. Il messaggio non è stato inviato.', 'error');
      }
    } finally {
      setStreamingText(null);
      setBusy(false);
    }
  };

  const regenerate = async () => {
    if (!chatId || busy) return;
    setBusy(true);
    try {
      const res = await api.post('/messages/regenerate', { chatId });
      setMessages((prev) =>
        prev.filter((m) => m._id !== res.data.replacedMessageId).concat([res.data.aiMessage])
      );
      if (typeof res.data.user?.credits === 'number') updateCredits(res.data.user.credits);
    } catch (err: any) {
      if (err.response?.status === 402) handleOutOfCredits();
      else notify(errorMessage(err, 'Impossibile rigenerare la risposta.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeMessage = async (messageId: string) => {
    try {
      await api.delete(`/messages/item/${messageId}`);
      setMessages((prev) => prev.filter((m) => m._id !== messageId));
    } catch {
      notify('Impossibile eliminare il messaggio.', 'error');
    }
  };

  const generateImage = async () => {
    const prompt = imagePrompt.trim();
    if (!prompt || !chatId) return;

    setGeneratingImage(true);
    try {
      const res = await api.post('/images/generate', { chatId, prompt });
      setMessages((prev) => [...prev, res.data.message]);
      if (typeof res.data.user?.credits === 'number') updateCredits(res.data.user.credits);
      setImagePrompt('');
      setImageOpen(false);
      requestAnimationFrame(() => scrollToBottom());
    } catch (err: any) {
      if (err.response?.status === 402) {
        setImageOpen(false);
        handleOutOfCredits();
      } else {
        notify(errorMessage(err, 'Impossibile generare l\'immagine.'), 'error');
      }
    } finally {
      setGeneratingImage(false);
    }
  };

  if (!user) {
    return (
      <EmptyState
        title="Accedi per aprire la conversazione"
        description="Le conversazioni sono legate al tuo account."
        action={
          <button onClick={() => useStore.getState().setAuthModalOpen(true, 'login')} className="btn-primary rounded-xl px-4 py-2 text-sm">
            Accedi
          </button>
        }
      />
    );
  }

  if (status === 'loading') return <Spinner label="Caricamento della conversazione…" />;

  if (status === 'notfound') {
    return (
      <EmptyState
        icon={<MessageSquareOff className="h-7 w-7" />}
        title="Conversazione non trovata"
        description="Potrebbe essere stata eliminata."
        action={<Link to="/" className="btn-secondary rounded-xl px-4 py-2 text-sm">Torna a Scopri</Link>}
      />
    );
  }

  if (status === 'error') return <ErrorState title="Impossibile caricare la conversazione" onRetry={reload} />;

  const displayCharacter: Character =
    character ?? ({ _id: '', name: chatTitle || 'Personaggio', avatar: '', description: '', personality: '', tags: [], category: '', isPublic: true, isNSFW: false, usageCount: 0 } as Character);

  return (
    <div className="flex h-[calc(100dvh_-_var(--yc-topbar,0px)_-_var(--yc-banner,0px))] flex-col">
      {/* Intestazione */}
      <header className="glass-panel flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={() => navigate(-1)} aria-label="Indietro" className="btn-ghost rounded-lg p-1.5">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          {character ? (
            <Link to={`/character/${character._id}`} className="flex min-w-0 items-center gap-2.5">
              <Avatar src={character.avatar} name={character.name} size={34} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-ink">{character.name}</span>
                <span className="block truncate text-xs text-ink-dim">Vedi la scheda</span>
              </span>
            </Link>
          ) : (
            <span className="text-sm font-semibold text-ink">{chatTitle}</span>
          )}
        </div>

{/* La generazione di immagini e' spenta durante la beta: il comando non
            viene mostrato invece di portare a un errore. */}
        {features.imageGeneration && (
          <button
            onClick={() => setImageOpen(true)}
            className="btn-secondary flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs"
          >
            <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Immagine</span>
            <span className="text-micro text-ink-dim">10</span>
          </button>
        )}
      </header>

      {/* Conversazione */}
      {/**
        * I messaggi si appoggiano al FONDO, non al soffitto.
        *
        * Una conversazione appena aperta ha due o tre messaggi: allineati in
        * alto lasciavano sotto di sé mezzo schermo vuoto, e il campo di
        * scrittura restava separato dall'ultima riga da un vuoto che non
        * significava niente. È il comportamento di ogni applicazione di
        * messaggistica, e la sua assenza è una delle cose che si notano senza
        * saper dire perché.
        *
        * `justify-end` su un contenitore alto quanto la finestra: finché i
        * messaggi non la riempiono si accumulano in basso; da quel momento in
        * poi il contenitore cresce e lo scorrimento riprende normalmente.
        */}
      <div ref={scrollRef} className="flex flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-end space-y-5 px-4 py-6">
          {hasMore && (
            <div className="flex justify-center">
              <button onClick={loadOlderKeepingPosition} disabled={loadingOlder} className="btn-secondary flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs">
                {loadingOlder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronUp className="h-3.5 w-3.5" />}
                Messaggi precedenti
              </button>
            </div>
          )}

          {messages.map((message, index) => (
            <MessageBubble
              key={message._id}
              message={message}
              character={displayCharacter}
              isLast={index === messages.length - 1 && streamingText === null}
              onRegenerate={message.role === 'assistant' ? regenerate : undefined}
              onDelete={removeMessage}
              onReport={(id) => setReportModalOpen(true, { type: 'message', id })}
            />
          ))}

          {/* Solo quando c'e' davvero del testo. Finche' `streamingText` e' la
              stringa vuota l'attesa la racconta l'indicatore qui sotto: prima
              comparivano ENTRAMBI, cioe' una bolla vuota con il cursore
              lampeggiante e, sotto, i tre puntini. */}
          {streamingText !== null && streamingText !== '' && (
            <MessageBubble
              message={{
                _id: 'streaming',
                chatId: chatId!,
                role: 'assistant',
                content: streamingText,
                createdAt: new Date().toISOString()
              }}
              character={displayCharacter}
              isLast
              streaming
            />
          )}

          {/* Vale anche per «rigenera», che prima non dava alcun segnale: si
              premeva il pulsante e per qualche secondo non succedeva nulla di
              visibile. */}
          {busy && !streamingText && (
            <div className="flex items-center gap-3" role="status" aria-label={`${displayCharacter.name} sta scrivendo`}>
              <Avatar src={displayCharacter.avatar} name={displayCharacter.name} size={32} />
              <div className="flex gap-1 rounded-2xl rounded-tl-sm border border-line bg-surface px-4 py-3.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-ink-dim"
                    style={{ animationDelay: `${i * 0.16}s` }}
                  />
                ))}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Composizione */}
      <div className="shrink-0 border-t border-line bg-bg-elevated px-4 py-3">
        <div className="mx-auto w-full max-w-3xl">
          <div className="field-shell flex items-end gap-2 rounded-2xl bg-surface p-2">
            <label htmlFor="composer" className="sr-only">Scrivi un messaggio a {displayCharacter.name}</label>
            <textarea
              id="composer"
              ref={textareaRef}
              rows={1}
              value={input}
              maxLength={MAX_LENGTH}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={`Scrivi a ${displayCharacter.name}…`}
              className="max-h-44 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-dim"
            />
            <button
              onClick={send}
              disabled={!input.trim() || busy}
              aria-label="Invia messaggio"
              className="btn-primary shrink-0 rounded-xl p-2.5"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-1.5 flex items-center justify-between px-1">
            <p className="text-micro text-ink-dim">Invio per inviare · Maiusc+Invio per andare a capo</p>
            {input.length > MAX_LENGTH * 0.8 && (
              <p className={`text-micro ${input.length >= MAX_LENGTH ? 'text-danger' : 'text-ink-dim'}`}>
                {input.length}/{MAX_LENGTH}
              </p>
            )}
          </div>
        </div>
      </div>

      <Modal open={imageOpen} onClose={() => setImageOpen(false)} title="Genera un'immagine">
        <p className="mb-3 text-sm text-ink-muted">
          Descrivi l'immagine da inserire nella conversazione. Costa <strong className="text-ink">10 crediti</strong>.
        </p>
        <label htmlFor="image-prompt" className="sr-only">Descrizione dell'immagine</label>
        <textarea
          id="image-prompt"
          rows={3}
          value={imagePrompt}
          onChange={(e) => setImagePrompt(e.target.value)}
          placeholder="Es. ritratto cyberpunk, toni scuri e luci soffuse…"
          className="input-field resize-none"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setImageOpen(false)} className="btn-secondary rounded-xl px-4 py-2 text-sm">Annulla</button>
          <button
            onClick={generateImage}
            disabled={!imagePrompt.trim() || generatingImage}
            className="btn-primary flex items-center gap-2 rounded-xl px-4 py-2 text-sm"
          >
            {generatingImage && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Genera
          </button>
        </div>
      </Modal>
    </div>
  );
}
