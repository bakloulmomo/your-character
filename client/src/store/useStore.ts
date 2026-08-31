import { create } from 'zustand';
import api, { setAuthToken } from '../services/api';

export interface Creator {
  _id?: string;
  username: string;
  avatar?: string;
}

export interface Character {
  _id: string;
  name: string;
  description: string;
  personality: string;
  backstory?: string;
  greetingMessage?: string;
  avatar: string;
  tags: string[];
  category: string;
  isPublic: boolean;
  isNSFW: boolean;
  // Stato di revisione (FASE D): un personaggio pubblico entra in coda prima
  // di comparire in galleria.
  moderationStatus?: 'pending' | 'approved' | 'rejected';
  moderationReason?: string;
  usageCount: number;
  chatCount?: number;
  createdBy?: Creator | string;
  createdAt?: string;
}

export interface MessageImage {
  url: string;
  prompt: string;
}

export interface Message {
  _id: string;
  chatId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  image?: MessageImage;
  error?: boolean;
  simulated?: boolean;
  // Messaggio prodotto dalla piattaforma (avviso di sicurezza o risposta a una
  // situazione di crisi), non parole del personaggio.
  safetyNotice?: boolean;
  pending?: boolean;
  createdAt: string;
}

/**
 * Forma normalizzata della chat usata in tutta l'interfaccia.
 *
 * Il server restituisce `characterId` a volte come identificatore e a volte
 * come documento popolato: prima ogni vista lo rattoppava a mano e qualunque
 * percorso non rattoppato faceva crashare il render (S3-18). L'adattatore
 * `normalizeChat` garantisce che qui dentro `character` sia sempre presente.
 */
export interface Chat {
  _id: string;
  character: Character | null;
  title: string;
  messageCount: number;
  lastMessageAt: string;
  updatedAt?: string;
}

export interface CookieConsentRecord {
  functional: boolean;
  version: string | null;
  updatedAt?: string | null;
}

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  avatar?: string | null;
  credits: number;
  subscription: string;
  subscriptionExpiresAt?: string | null;
  dailyMessageCount: number;
  dailyImageCount: number;
  role?: 'user' | 'moderator' | 'admin';
  isAdult?: boolean;
  nsfwEnabled?: boolean;
  cookieConsent?: CookieConsentRecord | null;
  billingCountry?: string | null;
}

/**
 * Interruttori di funzionalita' dichiarati dal server.
 *
 * L'interfaccia non deve offrire cio' che non esiste: un pulsante «Ricarica
 * crediti» che porta a un 404 e' peggio di un pulsante assente. Non e' una
 * difesa — quella sta sulle rotte — e' onesta' verso chi guarda.
 *
 * Il valore iniziale e' tutto SPENTO: finche' il server non ha risposto,
 * l'interfaccia non promette nulla. Il contrario farebbe comparire i pulsanti
 * per una frazione di secondo e poi sparire, che e' il modo peggiore.
 */
export interface Features {
  payments: boolean;
  subscriptions: boolean;
  imageGeneration: boolean;
}

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

/** Converte una chat grezza del server nella forma usata dall'interfaccia. */
export function normalizeChat(raw: any, fallbackCharacter?: Character | null): Chat {
  const populated = raw?.characterId;
  const character =
    populated && typeof populated === 'object' ? (populated as Character) : fallbackCharacter ?? null;

  return {
    _id: raw._id,
    character,
    title: raw.title ?? 'Nuova chat',
    messageCount: raw.messageCount ?? 0,
    lastMessageAt: raw.lastMessageAt ?? raw.updatedAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt
  };
}

interface AppState {
  // Configurazione dell'istanza
  features: Features;
  inviteRequired: boolean;
  /** 'mock' = pagamento simulato, nessun denaro si muove. Lo dichiara il server. */
  paymentsMode: 'mock' | 'live';
  isConfigResolved: boolean;
  setConfig: (config: { features: Features; inviteRequired: boolean; paymentsMode: 'mock' | 'live' }) => void;

  // Layout
  isSidebarCollapsed: boolean;
  isMobileSidebarOpen: boolean;
  toggleSidebar: () => void;
  setMobileSidebarOpen: (open: boolean) => void;

  // Autenticazione
  user: UserProfile | null;
  token: string | null;
  isAuthResolved: boolean;
  isAuthModalOpen: boolean;
  authModalMode: 'login' | 'register';
  setUser: (user: UserProfile | null) => void;
  setToken: (token: string | null) => void;
  setAuthResolved: (resolved: boolean) => void;
  setAuthModalOpen: (open: boolean, mode?: 'login' | 'register') => void;
  logout: () => Promise<void>;
  updateCredits: (credits: number) => void;
  patchUser: (patch: Partial<UserProfile>) => void;

  // Cronologia chat (sidebar)
  chats: Chat[];
  chatsStatus: 'idle' | 'loading' | 'ready' | 'error';
  /**
   * Per chi la cronologia è già stata chiesta — l'id dell'utente, o `'anon'`.
   *
   * `useChats()` è montato insieme dalla barra laterale e dalla pagina aperta:
   * senza questa memoria ogni copia faceva partire il proprio `GET /chats` e la
   * stessa risposta veniva scaricata due o tre volte a ogni cambio di pagina.
   * `null` significa «mai chiesta».
   */
  chatsLoadedFor: string | null;
  setChatsLoadedFor: (key: string | null) => void;
  setChats: (chats: Chat[]) => void;
  setChatsStatus: (status: 'idle' | 'loading' | 'ready' | 'error') => void;
  upsertChat: (chat: Chat) => void;
  removeChat: (chatId: string) => void;

  // Il banner dei cookie occupa spazio in fondo alla finestra: il guscio deve
  // saperlo per non lasciarglici sotto i comandi (vedi AppShell).
  // È un'ALTEZZA e non un interruttore: quanto sia alto dipende dalla lunghezza
  // del testo e dalla larghezza della finestra, e una stima fissa sbagliata di
  // dieci pixel lascia coperto esattamente il pulsante che stava coprendo prima.
  isCookieBannerOpen: boolean;
  cookieBannerHeight: number;
  setCookieBanner: (open: boolean, height?: number) => void;

  // Modali
  isFeedbackModalOpen: boolean;
  /** 'review' se l'utente lo cerca, 'wants_more' quando i crediti finiscono. */
  feedbackKind: 'review' | 'wants_more' | 'bug';
  setFeedbackModalOpen: (open: boolean, kind?: 'review' | 'wants_more' | 'bug') => void;
  isBuyCreditsModalOpen: boolean;
  isReportModalOpen: boolean;
  reportTarget: { type: 'character' | 'message' | 'user'; id: string } | null;
  setBuyCreditsModalOpen: (open: boolean) => void;
  setReportModalOpen: (open: boolean, target?: { type: 'character' | 'message' | 'user'; id: string } | null) => void;

  // Notifiche
  toasts: Toast[];
  notify: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  features: { payments: false, subscriptions: false, imageGeneration: false },
  inviteRequired: false,
  paymentsMode: 'mock',
  isConfigResolved: false,
  setConfig: ({ features, inviteRequired, paymentsMode }) =>
    set({ features, inviteRequired, paymentsMode, isConfigResolved: true }),

  isSidebarCollapsed: false,
  isMobileSidebarOpen: false,
  toggleSidebar: () => set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed })),
  setMobileSidebarOpen: (isMobileSidebarOpen) => set({ isMobileSidebarOpen }),

  user: null,
  /**
   * Il token vive SOLO in memoria.
   *
   * Prima stava anche in `localStorage`, quindi era leggibile da qualunque
   * script eseguito nella pagina: una singola XSS avrebbe consegnato una
   * sessione valida per sette giorni. La persistenza fra un caricamento e
   * l'altro e' affidata al cookie `yc_token`, che e' httpOnly — nessuno script
   * puo' leggerlo, nemmeno il nostro — e viaggia da solo perche' l'API e'
   * same-origin (vedi la riscrittura in vercel.json).
   *
   * Conseguenza voluta: ricaricando la pagina questo valore riparte da null e
   * la sessione viene ricostruita da /auth/me tramite il cookie.
   */
  token: null,
  isAuthResolved: false,
  isAuthModalOpen: false,
  authModalMode: 'login',

  setUser: (user) => set({ user }),
  setToken: (token) => {
    // L'interceptor legge da qui, non dallo store: evita un import circolare.
    setAuthToken(token);
    set({ token });
  },
  setAuthResolved: (isAuthResolved) => set({ isAuthResolved }),
  setAuthModalOpen: (isAuthModalOpen, authModalMode = 'login') => set({ isAuthModalOpen, authModalMode }),

  // Chiude la sessione anche sul server: cancellare il token locale lasciava
  // valido il cookie httpOnly e l'utente restava autenticato.
  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Si procede comunque con la pulizia locale.
    }
    // Il cookie viene cancellato dal server, che e' l'unico a poterlo fare:
    // e' httpOnly. Qui si ripulisce solo lo stato in memoria.
    setAuthToken(null);
    set({ user: null, token: null, chats: [], chatsStatus: 'idle', chatsLoadedFor: null });
  },

  updateCredits: (credits) =>
    set((s) => ({ user: s.user ? { ...s.user, credits } : null })),

  patchUser: (patch) => set((s) => ({ user: s.user ? { ...s.user, ...patch } : null })),

  chats: [],
  chatsStatus: 'idle',
  chatsLoadedFor: null,
  setChatsLoadedFor: (chatsLoadedFor) => set({ chatsLoadedFor }),
  setChats: (chats) => set({ chats }),
  setChatsStatus: (chatsStatus) => set({ chatsStatus }),
  upsertChat: (chat) =>
    set((s) => {
      const rest = s.chats.filter((c) => c._id !== chat._id);
      return { chats: [chat, ...rest] };
    }),
  removeChat: (chatId) => set((s) => ({ chats: s.chats.filter((c) => c._id !== chatId) })),

  isCookieBannerOpen: false,
  cookieBannerHeight: 0,
  setCookieBanner: (isCookieBannerOpen, cookieBannerHeight = 0) =>
    set({ isCookieBannerOpen, cookieBannerHeight }),

  isFeedbackModalOpen: false,
  feedbackKind: 'review',
  setFeedbackModalOpen: (isFeedbackModalOpen, feedbackKind = 'review') =>
    set({ isFeedbackModalOpen, feedbackKind }),
  isBuyCreditsModalOpen: false,
  isReportModalOpen: false,
  reportTarget: null,
  setBuyCreditsModalOpen: (isBuyCreditsModalOpen) => set({ isBuyCreditsModalOpen }),
  setReportModalOpen: (isReportModalOpen, reportTarget = null) =>
    set({ isReportModalOpen, reportTarget }),

  toasts: [],
  notify: (message, kind = 'info') => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), 5000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}));
