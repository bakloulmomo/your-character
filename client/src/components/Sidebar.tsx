import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Plus, Compass, Search, Sparkles, Trash2, MoreHorizontal,
  ChevronsLeft, ChevronsRight, LogOut, Settings, User as UserIcon, Coins, X, ShieldCheck
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
    setAuthModalOpen, setBuyCreditsModalOpen, features
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
        `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
          isActive ? 'bg-sapphire-wash text-sapphire-glow' : 'text-ink-muted hover:bg-surface hover:text-ink'
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
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
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
            <img src="/favicon_logo.jpeg" alt="" className="h-7 w-7 rounded-lg border border-line object-cover" />
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
          <Link
            to="/create"
            className={`btn-primary flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm ${collapsed ? 'md:px-0' : ''}`}
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
            {navItem('/search', 'Cerca', Search)}
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
              <h2 className="px-1 pb-2 font-mono text-[10px] uppercase tracking-widest text-ink-dim">
                Le tue chat
              </h2>

              {!user && (
                <p className="px-1 text-xs leading-relaxed text-ink-dim">
                  <button onClick={() => setAuthModalOpen(true, 'login')} className="text-sapphire-glow hover:underline">
                    Accedi
                  </button>{' '}
                  per ritrovare qui le tue conversazioni.
                </p>
              )}

              {user && status === 'loading' && (
                <div className="space-y-2" aria-label="Caricamento conversazioni">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-11 animate-pulse rounded-xl bg-surface" />
                  ))}
                </div>
              )}

              {user && status === 'ready' && chats.length === 0 && (
                <p className="px-1 text-xs leading-relaxed text-ink-dim">
                  Nessuna conversazione. Scegli un personaggio da <Link to="/" className="text-sapphire-glow hover:underline">Scopri</Link>.
                </p>
              )}

              {user && groups.map((group) => (
                <div key={group.label} className="mb-3">
                  <p className="px-1 pb-1 text-[10px] font-medium text-ink-dim">{group.label}</p>
                  <ul className="space-y-0.5">
                    {group.items.map((chat) => (
                      <li key={chat._id} className="group relative">
                        <Link
                          to={`/chat/${chat._id}`}
                          className={`flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors ${
                            openChatId === chat._id ? 'bg-sapphire-wash' : 'hover:bg-surface'
                          }`}
                        >
                          <Avatar src={chat.character?.avatar} name={chat.character?.name ?? chat.title} size={28} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-ink">
                              {chat.character?.name ?? chat.title}
                            </span>
                            <span className="block truncate text-[10px] text-ink-dim">
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
                          className="btn-ghost absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-1 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>

                        {menuOpenFor === chat._id && (
                          <div
                            className="absolute right-1 top-full z-20 mt-1 w-44 rounded-xl border border-line bg-bg-elevated p-1 shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={async () => {
                                setMenuOpenFor(null);
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
{/* Durante la beta non c'e' nulla da acquistare. Il comando sparisce
              invece di portare a un listino irraggiungibile. */}
          {!collapsed && features.payments && (
            <button
              onClick={() => setBuyCreditsModalOpen(true)}
              className="btn-primary mb-3 flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-xs"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Passa a Premium
            </button>
          )}

          {user ? (
            <div className="relative" ref={accountRef}>
              <button
                onClick={() => setAccountMenuOpen(!accountMenuOpen)}
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                className={`flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left transition-colors hover:bg-surface ${collapsed ? 'justify-center' : ''}`}
              >
                <Avatar src={user.avatar} name={user.username} size={28} rounded="full" />
                {!collapsed && (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-ink">@{user.username}</span>
                    <span className="block font-mono text-[10px] text-ink-dim">{user.credits} crediti</span>
                  </span>
                )}
              </button>

              {accountMenuOpen && (
                <div role="menu" className="absolute bottom-full left-0 z-30 mb-2 w-56 rounded-xl border border-line bg-bg-elevated p-1.5 shadow-2xl">
                  <div className="border-b border-line px-3 py-2">
                    <p className="truncate text-xs font-semibold text-ink">{user.username}</p>
                    <p className="truncate text-[10px] text-ink-dim">{user.email}</p>
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
                    onClick={async () => { setAccountMenuOpen(false); await logout(); navigate('/'); }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" /> Disconnetti
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className={`flex gap-2 ${collapsed ? 'flex-col items-center' : ''}`}>
              <button onClick={() => setAuthModalOpen(true, 'login')} className="btn-secondary flex-1 rounded-xl px-3 py-2 text-xs">
                {collapsed ? <UserIcon className="h-4 w-4" /> : 'Accedi'}
              </button>
              {!collapsed && (
                <button onClick={() => setAuthModalOpen(true, 'register')} className="btn-primary flex-1 rounded-xl px-3 py-2 text-xs">
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
