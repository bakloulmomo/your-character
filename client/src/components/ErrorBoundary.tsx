import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { reportError } from '../lib/monitoring';

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * Rete di sicurezza per gli errori di render (FASE E).
 *
 * Senza, un errore in un componente smonta l'intero albero e lascia una
 * **pagina bianca**: l'utente non sa se sia caduta la connessione, se il sito
 * sia rotto o se abbia sbagliato qualcosa, e a noi non arriva nulla.
 *
 * Il ricaricamento è un'azione esplicita e non automatica: un ricaricamento
 * automatico su un errore deterministico produce un ciclo infinito.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { componentStack: info.componentStack });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
        <AlertTriangle className="h-8 w-8 text-danger" aria-hidden="true" />
        <div>
          <h1 className="title-display text-display-sm">Qualcosa si è rotto in questa pagina</h1>
          <p className="mt-1 text-sm text-ink-muted">
            L'errore è stato registrato. Le tue conversazioni sono al sicuro.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.location.reload()} className="btn-primary rounded-xl px-4 py-2 text-sm">
            Ricarica la pagina
          </button>
          <a href="/" className="btn-secondary rounded-xl px-4 py-2 text-sm">Torna alla home</a>
        </div>
      </div>
    );
  }
}
