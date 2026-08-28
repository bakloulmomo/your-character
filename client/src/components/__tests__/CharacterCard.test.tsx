/**
 * FASE E — Card di un personaggio.
 *
 * Copre S3-7 (la card porta alla scheda, non apre una chat) e le etichette
 * introdotte in FASE D: un personaggio in revisione non è ancora in galleria e
 * deve dirlo al suo autore, altrimenti il fatto che non compaia sembra un guasto.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import CharacterCard from '../CharacterCard';
import { renderWithRouter, testCharacter, resetStore } from '../../test/helpers';

describe('CharacterCard', () => {
  it('porta alla scheda del personaggio, non dentro una chat nuova', () => {
    resetStore();
    renderWithRouter(<CharacterCard character={testCharacter({ _id: 'abc' })} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/character/abc');
  });

  it('mostra il conteggio reale delle conversazioni, formattato', () => {
    resetStore();
    renderWithRouter(<CharacterCard character={testCharacter({ chatCount: 1420 })} />);
    expect(screen.getByText('1.4k')).toBeInTheDocument();
  });

  it('segnala che un personaggio pubblico è in attesa di revisione', () => {
    resetStore();
    renderWithRouter(<CharacterCard character={testCharacter({ isPublic: true, moderationStatus: 'pending' })} />);
    expect(screen.getByText(/In revisione/i)).toBeInTheDocument();
  });

  it('segnala un personaggio respinto', () => {
    resetStore();
    renderWithRouter(<CharacterCard character={testCharacter({ isPublic: true, moderationStatus: 'rejected' })} />);
    expect(screen.getByText(/Respinto/i)).toBeInTheDocument();
  });

  it('un personaggio approvato non porta etichette di stato', () => {
    resetStore();
    renderWithRouter(<CharacterCard character={testCharacter({ moderationStatus: 'approved' })} />);
    expect(screen.queryByText(/In revisione|Respinto/i)).not.toBeInTheDocument();
  });

  it('marca i contenuti per adulti', () => {
    resetStore();
    renderWithRouter(<CharacterCard character={testCharacter({ isNSFW: true })} />);
    expect(screen.getByText('18+')).toBeInTheDocument();
  });
});
