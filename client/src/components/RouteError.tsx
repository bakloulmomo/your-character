import { useEffect } from 'react';
import { useRouteError, isRouteErrorResponse, Link, useLocation } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { reportError } from '../lib/monitoring';
import { Button } from './ui/Button';
import { PageContainer } from './ui/Page';

/**
 * Il guasto di UNA pagina resta dentro quella pagina.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * C'era un solo `ErrorBoundary`, attorno all'intera applicazione in
 * `main.tsx`. Faceva il suo mestiere — meglio di una pagina bianca — ma con
 * una conseguenza sproporzionata: un errore di render nella scheda di un
 * personaggio portava via anche la barra laterale, la cronologia e la
 * navigazione, e l'unica via d'uscita era ricaricare. Da un guasto locale,
 * un'applicazione ferma.
 *
 * Montato come `errorElement` su ogni rotta figlia di `AppShell`, il guscio
 * sopravvive: chi incappa nell'errore vede il messaggio dentro l'area del
 * contenuto e può semplicemente andare altrove, con un click, senza perdere
 * dove si trovava.
 *
 * Quello globale RESTA: copre ciò che sta fuori dalle rotte — il guscio
 * stesso, i modali, le notifiche — dove un errore non ha una pagina a cui
 * appartenere.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function RouteError() {
  const errore = useRouteError();
  const { pathname } = useLocation();

  useEffect(() => {
    /**
     * Un 404 di navigazione non è un guasto: non va segnalato.
     *
     * `isRouteErrorResponse` distingue una risposta del router (una rotta che
     * non esiste) da un'eccezione vera. Segnalare i primi riempirebbe il
     * monitoraggio di rumore prodotto da chi sbaglia a incollare un indirizzo,
     * e sotto quel rumore i guasti veri diventano invisibili.
     */
    if (isRouteErrorResponse(errore)) return;
    reportError(errore instanceof Error ? errore : new Error(String(errore)), { rotta: pathname });
  }, [errore, pathname]);

  const nonTrovata = isRouteErrorResponse(errore) && errore.status === 404;

  return (
    <PageContainer width="prose">
      <div role="alert" className="flex flex-col items-center gap-4 py-24 text-center">
        <AlertTriangle className="h-8 w-8 text-danger" aria-hidden="true" />
        <div>
          <h1 className="title-display text-display-sm">
            {nonTrovata ? 'Pagina non trovata' : 'Qualcosa si è rotto in questa pagina'}
          </h1>
          <p className="mt-2 max-w-prose text-sm text-ink-muted">
            {nonTrovata
              ? "L'indirizzo che hai aperto non esiste."
              : "L'errore è stato registrato. Il resto dell'applicazione funziona: le tue conversazioni sono al sicuro."}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {/* Un collegamento del router, non `window.location`: cambiare pagina
              non deve costare un ricaricamento completo. */}
          <Link to="/" className="contents">
            <Button variant="primary">Torna all'inizio</Button>
          </Link>
          {!nonTrovata && (
            <Button onClick={() => window.location.reload()}>Riprova a caricare</Button>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
