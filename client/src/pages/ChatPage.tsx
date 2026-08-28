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

const MAX_LENGTH = 4000;

export default function ChatPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { user, updateCredits, setBuyCreditsModalOpen, setReportModalOpen, notify } = useStore();
  const { reload: reloadChats } = useChats();
  const { messages, status, hasMore, loadingOlder, loadOlder, setMessages, reload } = useMessages(chatId);

  const [character, setCharacter] = useState<Character | null>(null);
  const [chatTitle, setChatTitle] = useState('');
  const [input, setInput] = useState('');
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [generatingImage, setGeneratingImage] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
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

  // Lo scorrimento resta dentro il contenitore della conversazione: prima
  // `scrollIntoView` muoveva l'intera finestra (S3-16).
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, []);

  useEffect(() => {
    if (status === 'ready') scrollToBottom('auto');
  }, [status, scrollToBottom]);

  useEffect(() => {
    if (streamingText !== null) scrollToBottom();
  }, [streamingText, scrollToBottom]);

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

    try {
      const token = localStorage.getItem('yc_token');
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
          setBuyCreditsModalOpen(true);
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
            setMessages((prev) => prev.filter((m) => m._id !== optimistic._id && !m.pending));
            setInput(text);
          }
          if (event.done) {
            setMessages((prev) => [...prev, event.aiMessage]);
            if (typeof event.user?.credits === 'number') updateCredits(event.user.credits);
            reloadChats();
          }
        }
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m._id !== optimistic._id));
      setInput(text);
      notify('Connessione interrotta. Il messaggio non è stato inviato.', 'error');
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
      if (err.response?.status === 402) setBuyCreditsModalOpen(true);
      else notify(err.response?.data?.error ?? 'Impossibile rigenerare la risposta.', 'error');
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
        setBuyCreditsModalOpen(true);
      } else {
        notify(err.response?.data?.error ?? 'Impossibile generare l\'immagine.', 'error');
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
    <div className="flex h-[calc(100dvh_-_var(--yc-banner,0px))] flex-col">
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
                <span className="block truncate text-[11px] text-ink-dim">Vedi la scheda</span>
              </span>
            </Link>
          ) : (
            <span className="text-sm font-semibold text-ink">{chatTitle}</span>
          )}
        </div>

        <button
          onClick={() => setImageOpen(true)}
          className="btn-secondary flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs"
        >
          <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Immagine</span>
          <span className="font-mono text-[10px] text-ink-dim">10</span>
        </button>
      </header>

      {/* Conversazione */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
          {hasMore && (
            <div className="flex justify-center">
              <button onClick={loadOlder} disabled={loadingOlder} className="btn-secondary flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs">
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

          {streamingText !== null && (
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

          {busy && streamingText === '' && (
            <div className="flex items-center gap-3">
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

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composizione */}
      <div className="shrink-0 border-t border-line bg-bg-elevated px-4 py-3">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface p-2 transition-colors focus-within:border-sapphire">
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
            <p className="text-[10px] text-ink-dim">Invio per inviare · Maiusc+Invio per andare a capo</p>
            {input.length > MAX_LENGTH * 0.8 && (
              <p className={`font-mono text-[10px] ${input.length >= MAX_LENGTH ? 'text-danger' : 'text-ink-dim'}`}>
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
