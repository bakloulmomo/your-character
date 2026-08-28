/**
 * FASE E — Modulo del consenso ai cookie (S2-6).
 *
 * La proprietà che conta non è che il valore venga salvato, ma che il consenso
 * *governi* qualcosa: prima era una stringa nel localStorage che nessuno
 * leggeva. Qui si verifica che la risposta a «posso caricare Stripe.js?»
 * cambi davvero con la scelta, e che il vecchio valore non venga ereditato.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CONSENT_VERSION, getConsent, needsDecision, setConsent, hasFunctionalConsent, subscribeConsent
} from '../consent';

describe('consenso ai cookie', () => {
  beforeEach(() => localStorage.clear());

  it('senza scelta chiede una decisione', () => {
    expect(needsDecision()).toBe(true);
    expect(getConsent()).toBeNull();
    expect(hasFunctionalConsent()).toBe(false);
  });

  it('rifiutare è una scelta registrata, non un\'assenza di scelta', () => {
    setConsent(false);
    expect(needsDecision()).toBe(false);
    expect(getConsent()?.functional).toBe(false);
    expect(getConsent()?.decidedAt).toBeTruthy();
  });

  it('il consenso governa davvero il caricamento anticipato di Stripe', () => {
    setConsent(false);
    expect(hasFunctionalConsent()).toBe(false);
    setConsent(true);
    expect(hasFunctionalConsent()).toBe(true);
  });

  it('i cookie essenziali non sono negoziabili e non fingono di esserlo', () => {
    expect(setConsent(false).essential).toBe(true);
  });

  it('un consenso raccolto su una versione precedente viene richiesto di nuovo', () => {
    localStorage.setItem(
      'yc_cookie_consent_v2',
      JSON.stringify({ essential: true, functional: true, version: '2020-01-01', decidedAt: '2020-01-01' })
    );
    expect(needsDecision()).toBe(true);
  });

  it('il valore del vecchio banner NON viene ereditato come consenso', () => {
    // Era una stringa raccolta da un banner che non governava nulla: non è un
    // consenso valido e va richiesto di nuovo.
    localStorage.setItem('yc_cookie_consent', 'accepted');
    expect(needsDecision()).toBe(true);
    expect(hasFunctionalConsent()).toBe(false);
  });

  it('il vecchio valore viene rimosso quando si decide', () => {
    localStorage.setItem('yc_cookie_consent', 'accepted');
    setConsent(true);
    expect(localStorage.getItem('yc_cookie_consent')).toBeNull();
  });

  it('un localStorage non disponibile non fa cadere l\'applicazione', () => {
    // Finestra privata o storage bloccato: la scelta vale per la sessione,
    // ma leggere non deve lanciare.
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage bloccato');
    });
    expect(() => getConsent()).not.toThrow();
    expect(getConsent()).toBeNull();
    spy.mockRestore();
  });

  it('notifica chi è in ascolto quando la scelta cambia', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConsent(listener);
    setConsent(true);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ functional: true, version: CONSENT_VERSION }));
    unsubscribe();
    setConsent(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
