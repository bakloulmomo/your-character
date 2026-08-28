/**
 * Ambiente condiviso dei test dell'interfaccia (FASE E).
 *
 * jsdom non implementa alcune API del browser che l'applicazione usa davvero.
 * Qui vengono fornite una volta sola: senza, ogni file di test dovrebbe
 * rifarle a mano e le copie divergerebbero.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// Usato dalla chat per scorrere in fondo: jsdom non lo implementa.
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.scrollTo = vi.fn();

// Usato dal campo di testo auto-espandibile.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  })) as unknown as typeof window.matchMedia;
}

// Usato dal banner dei cookie per misurare la propria altezza.
if (!window.ResizeObserver) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// L'esportazione dei dati e le ricevute costruiscono URL da Blob.
if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
}
