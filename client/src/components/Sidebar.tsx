import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Plus, Compass, Search, Sparkles, Trash2, MoreHorizontal,
  ChevronsLeft, ChevronsRight, LogOut, Settings, User as UserIcon, Coins, X, ShieldCheck, MessageSquareHeart
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useChats } from '../hooks/useChats';
import { groupByRecency, relativeTime } from '../lib/format';
import Avatar from './ui/Avatar';

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { chatId: openChatId } = useParams();

  const {
    user, logout, isSidebarCollapsed, toggleSidebar,
    isMobileSidebarOpen, setMobileSidebarOpen,
    setAuthModalOpen, setBuyCreditsModalOpen, features, setFeedbackModalOpen, askConfirm
  } = useStore();

  const { chats, status, deleteChat } = useChats();
  const [query, setQuery] = useState('');
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  // Chiude la barra mobile a ogni cambio di pagina.
  useEffect(() => {
    setMobileSidebarOpen(false);
    setMenuOpenFor(null);
  }, [location.pathname, setMobileSidebarOpen]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false);
      }
      setMenuOpenFor(null);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const term = query.trim();
    // La ricerca porta a una pagina con un indirizzo proprio, condivisibile.
    navigate(term ? `/search?q=${encodeURIComponent(term)}` : '/search');
  };

  const collapsed = isSidebarCollapsed;
  const groups = groupByRecency(chats);

  const navItem = (to: string, label: string, Icon: typeof Compass) => (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        /**
          * La voce attiva si distingue per INCHIOSTRO e PESO, non per colore.
          *
          * Prima accendeva un fondo azzurro, un testo azzurro e un filo
          * azzurro sul bordo: tre segnali per dire una cosa, nel colore che
          * l'interfaccia riserva alle azioni. Una barra laterale che si
          * illumina di blu ruba l'occhio al contenuto ogni volta che cambi
          * pagina. Qui l'attivo è semplicemente più chiaro e più pesante — il
          * modo in cui si è sempre segnata la voce corrente in un indice — con
          * un filo neutro a sinistra per chi distingue male i pesi.
          */
        `relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150 ${
          isActive
            ? 'font-medium text-ink before:absolute before:inset-y-1.5 before:left-0 before:w-px before:bg-ink-dim'
            : 'text-ink-dim hover:text-ink-muted'
        } ${collapsed ? 'justify-center px-0' : ''}`
      }
      title={collapsed ? label : undefined}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {!collapsed && <span>{label}</span>}
    </NavLink>
  );

  return (
    <>
      {/* Velo sotto la barra su mobile */}
      {isMobileSidebarOpen && (
        <div
          className="scrim fixed inset-0 z-30 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-line bg-bg-elevated transition-all duration-200
          ${collapsed ? 'md:w-16' : 'md:w-64'}
          w-72 ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
        aria-label="Navigazione principale"
      >
        {/* Intestazione */}
        <div className="flex items-center justify-between gap-2 px-3 py-3">
          <Link
            to="/"
            className={`flex items-center gap-2 font-display text-sm font-bold text-ink ${collapsed ? 'md:mx-auto' : ''}`}
          >
            <img src="/favicon_logo.jpeg" alt="" className="h-7 w-7 rounded-md object-cover" />
            {!collapsed && <span>your-character</span>}
          </Link>

          <button
            onClick={() => setMobileSidebarOpen(false)}
            aria-label="Chiudi menu"
            className="btn-ghost rounded-lg p-1.5 md:hidden"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Espandi barra laterale' : 'Comprimi barra laterale'}
            className="btn-ghost hidden rounded-lg p-1.5 md:block"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>

        <div className="flex flex-col gap-3 px-3">
          {/**
            * «Crea» non è più un blocco pieno d'accento.
            *
            * La regola dell'unico primario per volta valeva già, ma restava un
            * rettangolo azzurro saturo alto quanto due righe in cima alla
            * colonna: su una schermata di conversazione era l'elemento più
            * acceso dello schermo, e competeva con il testo che l'utente era
            * venuto a leggere. Una barra laterale è ARREDAMENTO — deve essere
            * trovabile, non vista.
            *
            * L'accento resta dov'è davvero l'azione del momento: il pulsante di
            * invio nella chat, l'invio del modulo d'accesso, i collegamenti.
            * Tre usi in tutta l'applicazione.
            */}
          <Link
            to="/create"
            className={`btn-secondary flex items-center justify-center gap-2 rounded-md py-2 text-sm ${collapsed ? 'md:px-0' : ''}`}
            title={collapsed ? 'Crea personaggio' : undefined}
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
            {!collapsed && <span>Crea</span>}
          </Link>

          {/* Un solo campo di ricerca, e funzionante */}
          {!collapsed && (
            <form onSubmit={submitSearch} role="search">
              <label htmlFor="sidebar-search" className="sr-only">Cerca personaggi</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-dim" aria-hidden="true" />
                <input
                  id="sidebar-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Cerca"
                  className="input-field py-2 pl-8 text-xs"
                />
              </div>
            </form>
          )}

          <nav className="flex flex-col gap-1">
            {navItem('/', 'Scopri', Compass)}
            {/* La voce «Cerca» esiste solo da compressa.
                Da espansa il campo qui sopra porta alla stessa pagina e ci
                arriva con il termine gia' scritto: averli entrambi significava
                due comandi identici a due centimetri di distanza, uno dei quali
                fa meno dell'altro. Da compressa il campo sparisce, e allora la
                voce e' l'unico modo per arrivarci. */}
            {collapsed && navItem('/search', 'Cerca', Search)}
            {user && navItem('/profile', 'I miei personaggi', Sparkles)}
            {/* Visibile solo al team: la coda di revisione non è una funzione
                del prodotto, è uno strumento di lavoro. */}
            {(user?.role === 'moderator' || user?.role === 'admin') &&
              navItem('/moderation', 'Moderazione', ShieldCheck)}
          </nav>
        </div>

        {/* Cronologia delle conversazioni */}
        <div className="mt-4 flex-1 overflow-y-auto px-3 pb-3">
          {!collapsed && (
            <>
              <h2 className="px-1 pb-2 eyebrow">
                Le tue chat
              </h2>

              {!user && (
                <p className="px-1 text-xs leading-relaxed text-ink-dim">
                  {/* Un collegamento dentro una frase si segnala con la
                      sottolineatura, che è il segno del collegamento da prima
                      del web. L'accento resta per le azioni. */}
                  <button onClick={() => setAuthModalOpen(true, 'login')} className="text-ink-muted underline underline-offset-2 hover:text-ink">
                    Accedi
                  </button>{' '}
                  per ritrovare qui le tue conversazioni.
                </p>
              )}

              {user && status === 'loading' && (
                <div className="space-y-2" aria-label="Caricamento conversazioni">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-11 animate-pulse rounded-md bg-surface" />
                  ))}
                </div>
              )}

              {user && status === 'ready' && chats.length === 0 && (
                <p className="px-1 text-xs leading-relaxed text-ink-dim">
                  Nessuna conversazione. Scegli un personaggio da <Link to="/" className="text-ink-muted underline underline-offset-2 hover:text-ink">Scopri</Link>.
                </p>
              )}

              {user && groups.map((group) => (
                <div key={group.label} className="mb-3">
                  <p className="px-1 pb-1 text-micro font-medium text-ink-dim">{group.label}</p>
                  <ul className="space-y-0.5">
                    {group.items.map((chat) => (
                      <li key={chat._id} className="group relative">
                        <Link
                          to={`/chat/${chat._id}`}
                          className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors ${
                            openChatId === chat._id ? 'bg-accent-wash' : 'hover:bg-surface'
                          }`}
                        >
                          <Avatar src={chat.character?.avatar} name={chat.character?.name ?? chat.title} size={28} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-ink">
                              {chat.character?.name ?? chat.title}
                            </span>
                            <span className="block truncate text-micro text-ink-dim">
                              {relativeTime(chat.lastMessageAt)}
                            </span>
                          </span>
                        </Link>

                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setMenuOpenFor(menuOpenFor === chat._id ? null : chat._id);
                          }}
                          aria-label={`Azioni per ${chat.character?.name ?? chat.title}`}
                          className="btn-ghost absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-1 hover-action"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>

                        {menuOpenFor === chat._id && (
                          <div
                            className="absolute right-1 top-full z-20 mt-1 w-44 rounded-lg bg-bg-elevated p-1 shadow-popover"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={async () => {
                                setMenuOpenFor(null);
                                // Il menu si apre da un'icona di tre puntini
                                // larga ventotto pixel, e questa voce cancella
                                // una conversazione intera con tutti i suoi
                                // messaggi. Prima non chiedeva niente.
                                const conferma = await askConfirm({
                                  title: `Sei sicuro di voler eliminare la conversazione con ${chat.character?.name ?? chat.title}?`,
                                  description: 'Tutti i messaggi scambiati vengono eliminati. L\'operazione non è reversibile.'
                                });
                                if (!conferma) return;

                                const removed = await deleteChat(chat._id);
                                if (removed && openChatId === chat._id) navigate('/');
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-danger transition-colors hover:bg-danger/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Elimina conversazione
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}

          {collapsed && user && chats.length > 0 && (
            <ul className="flex flex-col items-center gap-2">
              {chats.slice(0, 8).map((chat) => (
                <li key={chat._id}>
                  <Link to={`/chat/${chat._id}`} title={chat.character?.name ?? chat.title}>
                    <Avatar src={chat.character?.avatar} name={chat.character?.name ?? chat.title} size={32} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Account */}
        <div className="border-t border-line p-3">
{/* Durante la beta non c'e' nulla da acquistare: il comando sparisce
              invece di portare a un listino irraggiungibile.
              La condizione `user` non e' un permesso — l'acquisto lo richiede
              gia' — e' la stessa regola dell'unico primario per volta: a chi
              non ha ancora un account questo pulsante compariva blu proprio
              sopra «Registrati», altrettanto blu, e i due si contendevano
              l'attenzione mentre solo uno dei due e' il passo successivo. */}
          {user && !collapsed && features.payments && (
            <button
              onClick={() => setBuyCreditsModalOpen(true)}
              className="btn-secondary mb-3 flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-xs"
            >
              {/* Secondario, non primario. Il primario della barra laterale e'
                  «Crea»: e' l'azione che il prodotto vuole far compiere, e due
                  pulsanti pieni dello stesso blu agli estremi della stessa
                  colonna se ne contendono l'attenzione. L'icona in accento
                  tiene comunque l'offerta visibile. */}
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Passa a Premium
            </button>
          )}

          {/* Durante la beta il canale di feedback e' la funzione piu'
              importante dopo la chat: e' l'unico modo per sapere se le persone
              tornerebbero. Sta in fondo, visibile ma non invadente. */}
          {user && !collapsed && !features.payments && (
            <button
              onClick={() => setFeedbackModalOpen(true, 'review')}
              className="btn-secondary mb-3 flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-xs"
            >
              <MessageSquareHeart className="h-3.5 w-3.5" aria-hidden="true" />
              Dicci cosa ne pensi
            </button>
          )}

          {user ? (
            <div className="relative" ref={accountRef}>
              <button
                onClick={() => setAccountMenuOpen(!accountMenuOpen)}
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                className={`flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-surface ${collapsed ? 'justify-center' : ''}`}
              >
                <Avatar src={user.avatar} name={user.username} size={28} rounded="full" />
                {!collapsed && (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">@{user.username}</span>
                    <span className="tabular block text-micro text-ink-dim">{user.credits} crediti</span>
                  </span>
                )}
              </button>

              {accountMenuOpen && (
                <div role="menu" className="absolute bottom-full left-0 z-30 mb-2 w-56 rounded-lg bg-bg-elevated p-1.5 shadow-popover">
                  <div className="border-b border-line px-3 py-2">
                    <p className="truncate text-xs font-semibold text-ink">{user.username}</p>
                    <p className="truncate text-micro text-ink-dim">{user.email}</p>
                  </div>
                  <Link to="/profile" role="menuitem" onClick={() => setAccountMenuOpen(false)} className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-ink-muted transition-colors hover:bg-surface hover:text-ink">
                    <UserIcon className="h-4 w-4" aria-hidden="true" /> Profilo
                  </Link>
                  {features.payments && (
                    <button role="menuitem" onClick={() => { setAccountMenuOpen(false); setBuyCreditsModalOpen(true); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-ink-muted transition-colors hover:bg-surface hover:text-ink">
                      <Coins className="h-4 w-4" aria-hidden="true" /> Ricarica crediti
                    </button>
                  )}
                  <Link to="/settings" role="menuitem" onClick={() => setAccountMenuOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-ink-muted transition-colors hover:bg-surface hover:text-ink">
                    <Settings className="h-4 w-4" aria-hidden="true" /> Impostazioni
                  </Link>
                  <div className="my-1 border-t border-line" />
                  <button
                    role="menuitem"
                    onClick={async () => {
                      setAccountMenuOpen(false);
                      /**
                       * Non distrugge nulla, quindi non è rossa: `destructive:
                       * false`. Il rosso deve restare il colore di ciò che non
                       * si recupera, altrimenti smette di significarlo.
                       */
                      const conferma = await askConfirm({
                        title: 'Vuoi disconnetterti?',
                        description: 'Le tue conversazioni restano al loro posto: le ritrovi al prossimo accesso.',
                        confirmLabel: 'Disconnetti',
                        cancelLabel: 'Resta connesso',
                        destructive: false
                      });
                      if (!conferma) return;

                      await logout();
                      navigate('/');
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" /> Disconnetti
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className={`flex gap-2 ${collapsed ? 'flex-col items-center' : ''}`}>
              <button onClick={() => setAuthModalOpen(true, 'login')} className="btn-secondary flex-1 rounded-md px-3 py-2 text-xs">
                {collapsed ? <UserIcon className="h-4 w-4" /> : 'Accedi'}
              </button>
              {!collapsed && (
                <button onClick={() => setAuthModalOpen(true, 'register')} className="btn-primary flex-1 rounded-md px-3 py-2 text-xs">
                  Registrati
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
