/**
 * Impalcatura condivisa per i test dei componenti (FASE E).
 *
 * Ogni pagina di questa applicazione dipende da tre cose: il router, lo store e
 * il client HTTP. Tenerne la preparazione in un solo posto evita che ogni file
 * di test ne inventi una versione leggermente diversa — che è il modo in cui
 * una suite smette di dire la verità sul comportamento reale.
 */
import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useStore, type UserProfile, type Character } from '../store/useStore';

export const testUser = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  id: 'u1',
  email: 'anna@example.com',
  username: 'anna',
  credits: 10,
  subscription: 'free',
  dailyMessageCount: 0,
  dailyImageCount: 0,
  role: 'user',
  isAdult: true,
  nsfwEnabled: false,
  ...overrides
});

export const testCharacter = (overrides: Partial<Character> = {}): Character => ({
  _id: 'c1',
  name: 'Aria Thorne',
  description: 'Una guida per esplorare le proprie idee.',
  personality: 'Empatica e brillante.',
  avatar: 'https://example.com/aria.jpg',
  tags: ['scrittura'],
  category: 'assistant',
  isPublic: true,
  isNSFW: false,
  moderationStatus: 'approved',
  usageCount: 1200,
  ...overrides
});

/**
 * Riporta lo store allo stato iniziale fra un test e l'altro.
 *
 * Deve elencare OGNI campo che un test possa modificare: quelli dimenticati
 * sopravvivono al test che li ha scritti e finiscono nel successivo, che
 * comincia a passare o fallire per ragioni che non gli appartengono. È già
 * successo con `features`, aggiunto allo store e non qui.
 */
export function resetStore(partial: Record<string, unknown> = {}) {
  useStore.setState({
    user: null,
    token: null,
    isAuthResolved: true,
    isAuthModalOpen: false,
    isBuyCreditsModalOpen: false,
    isReportModalOpen: false,
    reportTarget: null,
    chats: [],
    chatsStatus: 'ready',
    toasts: [],
    // Stato di partenza dell'istanza: tutto spento, come prima che il server
    // risponda a /api/config.
    features: { payments: false, subscriptions: false, imageGeneration: false },
    inviteRequired: false,
    paymentsMode: 'mock' as const,
    isConfigResolved: false,
    ...partial
  });
}

interface Options {
  route?: string;
  path?: string;
}

/** Monta un componente dentro un router in memoria, all'indirizzo indicato. */
export function renderWithRouter(ui: ReactElement, { route = '/', path }: Options = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      {path ? <Routes><Route path={path} element={ui} /></Routes> : ui}
    </MemoryRouter>
  );
}
