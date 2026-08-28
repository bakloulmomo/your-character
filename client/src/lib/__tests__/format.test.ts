/**
 * FASE E — Formattazione dei messaggi e dei metadati.
 *
 * `parseMessage` è la correzione S3-15: prima gli asterischi delle azioni
 * narrative restavano visibili e gli a-capo collassavano. È logica pura ed è
 * esattamente il genere di cosa che si rompe in silenzio.
 */
import { describe, it, expect } from 'vitest';
import { formatCount, initialsOf, parseMessage, groupByRecency } from '../format';

describe('parseMessage', () => {
  it('mette in corsivo le azioni narrative fra asterischi', () => {
    expect(parseMessage('*sorride* Ciao!')).toEqual([
      { text: 'sorride', italic: true },
      { text: ' Ciao!', italic: false }
    ]);
  });

  it('gestisce più azioni nello stesso messaggio', () => {
    const parts = parseMessage('*si alza* Andiamo. *apre la porta*');
    expect(parts.filter((p) => p.italic).map((p) => p.text)).toEqual(['si alza', 'apre la porta']);
  });

  it('un asterisco spaiato resta testo, non manda in confusione il rendering', () => {
    expect(parseMessage('2 * 3 = 6')).toEqual([{ text: '2 * 3 = 6', italic: false }]);
  });

  it('un asterisco non attraversa un a-capo', () => {
    // Altrimenti un elenco puntato diventerebbe un blocco in corsivo.
    const parts = parseMessage('*prima riga\nseconda riga*');
    expect(parts.every((p) => !p.italic)).toBe(true);
  });

  it('un messaggio senza asterischi resta intatto', () => {
    expect(parseMessage('Testo semplice')).toEqual([{ text: 'Testo semplice', italic: false }]);
  });
});

describe('formatCount', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1k'],
    [1420, '1.4k'],
    [15000, '15k'],
    [2_400_000, '2.4M']
  ])('%i → %s', (input, expected) => {
    expect(formatCount(input)).toBe(expected);
  });

  it('un conteggio assente vale zero, non "undefined"', () => {
    expect(formatCount(undefined)).toBe('0');
  });
});

describe('initialsOf', () => {
  it('prende al massimo due iniziali', () => {
    expect(initialsOf('Aria Thorne')).toBe('AT');
    expect(initialsOf('Marcus')).toBe('M');
    expect(initialsOf('Anna Maria De Luca')).toBe('AM');
  });
});

describe('groupByRecency', () => {
  it('raggruppa per fascia e omette le fasce vuote', () => {
    const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();
    const groups = groupByRecency([
      { lastMessageAt: iso(1) },
      { lastMessageAt: iso(30) },
      { lastMessageAt: iso(24 * 20) }
    ]);

    expect(groups.map((g) => g.label)).toEqual(['Oggi', 'Ieri', 'Precedenti']);
  });
});
