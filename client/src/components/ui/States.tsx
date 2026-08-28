import { Loader2, AlertTriangle, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';

/** Scheletro di caricamento con la forma delle card reali. */
export function CardSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-line bg-surface p-4">
          <div className="mb-3 flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-line" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-2/3 rounded bg-line" />
              <div className="h-2 w-1/3 rounded bg-line/60" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-2 w-full rounded bg-line/60" />
            <div className="h-2 w-4/5 rounded bg-line/60" />
          </div>
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
        <button onClick={onRetry} className="btn-secondary mt-2 rounded-xl px-4 py-2 text-sm">
          Riprova
        </button>
      )}
    </div>
  );
}
