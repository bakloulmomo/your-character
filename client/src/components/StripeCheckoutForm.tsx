import { useState } from 'react';
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Loader2, Lock, AlertTriangle } from 'lucide-react';

interface Props {
  /** Etichetta dell'importo mostrata sul pulsante di conferma. */
  amountLabel: string;
  /** Chiamata quando Stripe conferma il pagamento: i crediti arrivano poi dal webhook. */
  onSucceeded: () => void;
  onCancel: () => void;
}

/**
 * Modulo di pagamento reale con Stripe Elements.
 *
 * I dati della carta non transitano mai dal nostro server: vengono raccolti
 * dall'iframe di Stripe e confermati direttamente con Stripe. I crediti non
 * vengono accreditati qui, ma dal webhook firmato lato server — è l'unico
 * punto di cui ci fidiamo per considerare un pagamento avvenuto.
 */
export default function StripeCheckoutForm({ amountLabel, onSucceeded, onCancel }: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || submitting) return;

    setSubmitting(true);
    setError(null);

    const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required'
    });

    if (stripeError) {
      setError(stripeError.message || 'Pagamento non riuscito. Controlla i dati della carta.');
      setSubmitting(false);
      return;
    }

    if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
      onSucceeded();
      return;
    }

    setError('Il pagamento non è stato completato. Riprova.');
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement options={{ layout: 'tabs' }} />

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
        <span className="flex items-center gap-1.5 text-[11px] text-ink-dim">
          <Lock className="h-3.5 w-3.5 text-ink-muted" />
          Pagamento gestito da Stripe
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="btn-secondary rounded-md px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Annulla
          </button>
          <button
            type="submit"
            disabled={!stripe || submitting}
            className="btn-primary flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {submitting ? 'Elaborazione…' : `Paga ${amountLabel}`}
          </button>
        </div>
      </div>
    </form>
  );
}
