import { Loader2, AlertTriangle, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';

/**
 * Scheletro di caricamento con la forma della card VERA.
 *
 * Non lo era. Disegnava un rettangolo bordato con un avatar tondo a sinistra e
 * due righe di testo a destra — la forma che le schede avevano due revisioni
 * fa — su una griglia a colonne fisse. La card reale è un ritratto 4:5 senza
 * bordo e senza fondo, con il nome sotto, su una griglia `auto-fill`. Cioè: il
 * caricamento mostrava una cosa, e al suo posto ne compariva un'altra, di
 * dimensioni diverse, facendo saltare l'impaginazione a ogni apertura.
 *
 * Uno scheletro che non combacia è peggio di nessuno scheletro: promette una
 * disposizione e poi la smentisce. Le misure qui sotto sono le stesse di
 * `CharacterCard` variante griglia e della griglia di `DiscoverPage` — se una
 * delle due cambia, va cambiata anche questa.
 */
export function CardSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      className="grid gap-x-8 gap-y-14 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]"
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="mb-3.5 aspect-[4/5] rounded-lg bg-surface" />
          <div className="h-4 w-3/5 rounded bg-surface" />
          <div className="mt-2.5 h-2.5 w-full rounded bg-surface/70" />
          <div className="mt-1.5 h-2.5 w-4/5 rounded bg-surface/70" />
        </div>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-ink-muted">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}

interface MessageStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

export function EmptyState({ title, description, action, icon }: MessageStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="text-ink-dim" aria-hidden="true">{icon ?? <Inbox className="h-7 w-7" />}</div>
      <p className="text-base font-medium text-ink">{title}</p>
      {description && <p className="max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, description, onRetry }: { title: string; description?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center" role="alert">
      <AlertTriangle className="h-7 w-7 text-danger" aria-hidden="true" />
      <p className="text-base font-medium text-ink">{title}</p>
      {description && <p className="max-w-sm text-sm text-ink-muted">{description}</p>}
      {onRetry && (
        <Button onClick={onRetry} className="mt-2">
          Riprova
        </Button>
      )}
    </div>
  );
}
