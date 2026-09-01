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

  /**
   * I metadati stanno in UNA riga sola, separati da un punto medio, invece che
   * in etichette distinte: con la revisione «Rivista» ogni scheda mostrava sei
   * elementi, e le due pastiglie colorate dei tag erano rumore per un dato che
   * nessuno usa per scegliere. Il testo cercato non è più un nodo isolato,
   * quindi l'asserzione cerca il valore DENTRO la riga — che è ciò che il test
   * voleva verificare fin dall'inizio: che il numero sia quello vero e
   * formattato, non che viva in un elemento tutto suo.
   */
  it('mostra il conteggio reale delle conversazioni, formattato', () => {
    resetStore();
    renderWithRouter(<CharacterCard character={testCharacter({ chatCount: 1420 })} />);
    expect(screen.getByText(/1\.4k conversazioni/)).toBeInTheDocument();
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
    expect(screen.getByText(/18\+/)).toBeInTheDocument();
  });

  it('non nomina l\'autore quando il personaggio è del catalogo', () => {
    resetStore();
    renderWithRouter(
      <CharacterCard character={testCharacter({ createdBy: { username: 'system_admin' } })} />
    );
    // «di @system_admin» compariva su ogni scheda della galleria: su un
    // catalogo curato l'autore è sempre lo stesso, quindi non distingue nulla.
    expect(screen.queryByText(/system_admin/)).not.toBeInTheDocument();
  });

  it('nomina l\'autore quando il personaggio è di un utente', () => {
    resetStore();
    renderWithRouter(
      <CharacterCard character={testCharacter({ createdBy: { username: 'anna' } })} />
    );
    expect(screen.getByText(/@anna/)).toBeInTheDocument();
  });
});
