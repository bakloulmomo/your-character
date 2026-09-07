import { useEffect, useState } from 'react';
import { Check, ShieldCheck, Loader2 } from 'lucide-react';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useStore } from '../store/useStore';
import Modal from './ui/Modal';
import { hasFunctionalConsent } from '../lib/consent';
import api from '../services/api';
import StripeCheckoutForm from './StripeCheckoutForm';
import { errorMessage } from '../lib/apiError';
import { reportError } from '../lib/monitoring';

// La chiave pubblicabile è, appunto, pubblica: identifica l'account Stripe e
// non autorizza nulla da sola. Se manca, il pagamento con carta non viene
// nemmeno offerto invece di fingere che funzioni.
const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;

/**
 * Stripe.js viene caricato PIGRAMENTE (FASE D — S2-6).
 *
 * Prima `loadStripe` era invocata a livello di modulo: lo script di terze parti
 * partiva al caricamento dell'applicazione, prima che chiunque avesse scelto
 * alcunché nel banner dei cookie. Ora parte in due soli casi:
 *  · la persona ha dato il consenso funzionale (precaricamento, checkout più
 *    rapido), oppure
 *  · sta aprendo il modulo di pagamento — necessario per eseguire il pagamento
 *    che ha appena richiesto, quindi non subordinato al consenso.
 */
let stripeInstance: ReturnType<typeof loadStripe> | null = null;
const getStripe = () => {
  if (!STRIPE_PUBLISHABLE_KEY) return null;
  if (!stripeInstance) stripeInstance = loadStripe(STRIPE_PUBLISHABLE_KEY);
  return stripeInstance;
};
const stripeAvailable = !!STRIPE_PUBLISHABLE_KEY;

const SUBSCRIPTIONS = [
  {
    id: 'monthly',
    name: 'Mensile',
    price: '€4.99',
    period: '/mese',
    perks: ['50 messaggi/giorno', '5 immagini/giorno', 'Nessuna gestione crediti']
  },
  {
    id: 'annual',
    name: 'Annuale',
    price: '€49.99',
    period: '/anno',
    perks: ['100 messaggi/giorno', '10 immagini/giorno', '2 mesi gratis']
  }
];

const PACKAGES = [
  {
    id: 'starter',
    name: 'Starter',
    credits: 50,
    price: '€2.99',
    description: 'Ideale per provare la piattaforma.'
  },
  {
    id: 'popular',
    name: 'Popular',
    credits: 150,
    price: '€4.99',
    description: 'Per conversazioni giornaliere ed immagini AI.'
  },
  {
    id: 'premium',
    name: 'Premium',
    credits: 600,
    price: '€14.99',
    description: 'Massima convenienza per uso intensivo.'
  }
];

export default function BuyCreditsModal() {
  const { isBuyCreditsModalOpen, setBuyCreditsModalOpen, updateCredits, user, setUser, features, paymentsMode } = useStore();
  const [selectedPack, setSelectedPack] = useState('popular');
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [error, setError] = useState('');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [awaitingCredits, setAwaitingCredits] = useState(false);

  // Con il consenso funzionale lo script può essere preparato all'apertura del
  // modale, così il modulo di pagamento compare subito quando serve.
  useEffect(() => {
    if (isBuyCreditsModalOpen && hasFunctionalConsent()) getStripe();
  }, [isBuyCreditsModalOpen]);

  // Seconda barriera, dopo quella sulle rotte: se i pagamenti sono spenti il
  // modale non si apre nemmeno se qualcosa provasse ad aprirlo.
  if (!features.payments) return null;

  const selectedPackage = PACKAGES.find((p) => p.id === selectedPack)!;

  /**
   * Dopo la conferma su Stripe i crediti arrivano dal webhook, che è
   * asincrono. Si interroga il saldo per qualche secondo invece di dichiarare
   * un accredito che non è ancora avvenuto.
   */
  const pollForCredits = async () => {
    setAwaitingCredits(true);
    const startingCredits = user?.credits ?? 0;

    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const res = await api.get('/users/me/credits');
        if (typeof res.data.credits === 'number' && res.data.credits > startingCredits) {
          updateCredits(res.data.credits);
          setAwaitingCredits(false);
          setClientSecret(null);
          setSuccessMsg('Pagamento completato: crediti accreditati.');
          setTimeout(() => {
            setBuyCreditsModalOpen(false);
            setSuccessMsg('');
          }, 1800);
          return;
        }
      } catch {
        // Si continua a interrogare: la conferma può tardare qualche secondo.
      }
    }

    setAwaitingCredits(false);
    setClientSecret(null);
    setSuccessMsg('Pagamento ricevuto. I crediti compariranno a breve sul tuo saldo.');
  };

  const handleCheckout = async () => {
    if (!user) {
      setError('Effettua l\'accesso per acquistare crediti.');
      return;
    }
    setLoading(true);
    setSuccessMsg('');
    setError('');
    try {
      const checkout = await api.post('/payments/checkout', { packageId: selectedPack });
      const { transactionId, mode } = checkout.data;

      // Percorso reale: Stripe restituisce un clientSecret e la carta viene
      // inserita nel modulo Elements qui sotto.
      if (checkout.data.clientSecret && mode !== 'mock') {
        if (!stripeAvailable) {
          setError('Pagamenti non configurati su questa installazione (manca VITE_STRIPE_PUBLISHABLE_KEY).');
          return;
        }
        setClientSecret(checkout.data.clientSecret);
        return;
      }

      if (mode === 'mock' && transactionId) {
        // Mock mode: settle the payment SERVER-SIDE so credits are actually granted.
        const confirm = await api.post('/payments/confirm', { transactionId });
        if (typeof confirm.data.credits === 'number') {
          updateCredits(confirm.data.credits); // absolute balance from the server
        }
        setSuccessMsg('Crediti accreditati con successo!');
        setTimeout(() => {
          setBuyCreditsModalOpen(false);
          setSuccessMsg('');
        }, 1500);
      } else {
        setError('Impossibile avviare il pagamento. Riprova fra poco.');
      }
    } catch (err: any) {
      reportError(err, { scope: 'checkout' });
      setError(errorMessage(err, 'Impossibile completare l\'acquisto. Riprova.'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async (planId: string) => {
    if (!user) {
      setError('Effettua l\'accesso per abbonarti.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await api.post('/payments/subscribe', { plan: planId });
      if (res.data.url) {
        // `assign` invece dell'assegnazione a `location.href`: stessa cosa, ma
        // dichiara l'intento di navigare invece di sembrare la modifica di una
        // variabile globale.
        window.location.assign(res.data.url); // Stripe Checkout reale
        return;
      }
      if (res.data.subscription) {
        setUser({ ...user, subscription: res.data.subscription });
        setSuccessMsg('Abbonamento attivato con successo!');
        setTimeout(() => {
          setBuyCreditsModalOpen(false);
          setSuccessMsg('');
        }, 1500);
      }
    } catch (err: any) {
      reportError(err, { scope: 'subscribe' });
      setError(errorMessage(err, 'Impossibile attivare l\'abbonamento.'));
    } finally {
      setLoading(false);
    }
  };

  const handleCancelSubscription = async () => {
    setLoading(true);
    setError('');
    try {
      await api.post('/payments/cancel-subscription', {});
      if (user) setUser({ ...user, subscription: 'free' });
      setSuccessMsg('Abbonamento annullato.');
      setTimeout(() => setSuccessMsg(''), 1500);
    } catch (err: any) {
      reportError(err, { scope: 'cancel-subscription' });
      setError(errorMessage(err, 'Impossibile annullare l\'abbonamento.'));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Anche questo passa dal Modal condiviso: stesso difetto di ReportModal —
   * nessun ruolo, nessuna chiusura con Esc, focus non intrappolato ne'
   * restituito. Su una finestra che chiede i dati di una carta, essere
   * inutilizzabile da tastiera non e' un dettaglio.
   */
  return (
    <Modal
      open={isBuyCreditsModalOpen}
      onClose={() => setBuyCreditsModalOpen(false)}
      title={features.subscriptions ? 'Abbonamenti e crediti' : 'Ricarica crediti'}
      size="lg"
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto">

        {successMsg && (
          <div role="status" className="flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
            <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
            {successMsg}
          </div>
        )}

        {error && (
          <div role="alert" className="animate-shake rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        {/* Pagamento con carta: sostituisce il listino una volta avviato */}
        {clientSecret && stripeAvailable && (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-surface p-3 text-sm text-ink-muted">
              <div className="flex items-center justify-between">
                <span className="font-medium">{selectedPackage.name} · {selectedPackage.credits} crediti</span>
                <span className="tabular-nums">{selectedPackage.price}</span>
              </div>
            </div>

            {awaitingCredits ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Loader2 className="h-5 w-5 animate-spin text-ink-muted" />
                <p className="text-xs text-ink-muted">Pagamento confermato. Stiamo accreditando i crediti…</p>
                <p className="max-w-xs text-xs text-ink-dim">
                  L'accredito è confermato dal nostro server, non dal browser: può richiedere qualche secondo.
                </p>
              </div>
            ) : (
              <Elements
                stripe={getStripe()}
                options={{ clientSecret, appearance: { theme: 'night', labels: 'floating' } }}
              >
                <StripeCheckoutForm
                  amountLabel={selectedPackage.price}
                  onSucceeded={pollForCredits}
                  onCancel={() => setClientSecret(null)}
                />
              </Elements>
            )}
          </div>
        )}

        {!clientSecret && (
        <>
        {/* Abbonamenti — accesi separatamente dai pagamenti: un pacchetto
            crediti incassa prima di spendere, un abbonamento no. */}
        {features.subscriptions && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-ink-muted">Abbonamenti</h3>
            {user && user.subscription !== 'free' && (
              <span className="text-micro text-success">Attivo: {user.subscription}</span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SUBSCRIPTIONS.map((s) => {
              const isCurrent = user?.subscription === s.id;
              return (
                <div key={s.id} className="flex flex-col justify-between rounded-xl border border-line bg-surface p-4">
                  <div>
                    <div className="text-xs font-medium text-ink-muted mb-1">{s.name}</div>
                    <div className="title-display tabular mb-2 text-display-sm">
                      {s.price}<span className="text-xs text-ink-dim font-normal">{s.period}</span>
                    </div>
                    <ul className="space-y-1 mb-3">
                      {s.perks.map((p) => (
                        <li key={p} className="text-xs text-ink-muted flex items-center gap-1.5">
                          <Check className="w-3 h-3 text-accent-glow shrink-0" />{p}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <button
                    onClick={() => handleSubscribe(s.id)}
                    disabled={loading || isCurrent}
                    className="btn-primary w-full rounded-xl py-2 text-xs font-medium"
                  >
                    {isCurrent ? 'Piano attuale' : 'Abbonati'}
                  </button>
                </div>
              );
            })}
          </div>
          {user && user.subscription !== 'free' && (
            <button
              onClick={handleCancelSubscription}
              disabled={loading}
              className="mt-2 rounded-lg px-2 py-1 text-xs text-danger transition-colors hover:bg-danger/10"
            >
              Annulla abbonamento
            </button>
          )}
        </div>
        )}

        {/* Separatore: ha senso solo se sopra c'e' davvero qualcos'altro. */}
        {features.subscriptions && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-surface-hover" />
          <span className="text-micro text-ink-dim">oppure crediti una tantum</span>
          <div className="flex-1 h-px bg-surface-hover" />
        </div>
        )}

        {/**
          * Scelta del pacchetto: un gruppo di pulsanti radio veri.
          *
          * Erano tre `<div onClick>`. Un div non entra nell'ordine di
          * tabulazione, non risponde a Invio o Spazio e non ha alcun ruolo:
          * chi naviga da tastiera — o con uno screen reader — non poteva
          * cambiare pacchetto, e restava vincolato a quello preselezionato.
          * Nella pagina in cui si spendono soldi.
          *
          * `role="radio"` più `aria-checked` è ciò che rende la scelta
          * annunciabile; `<button>` è ciò che la rende raggiungibile.
          */}
        <div role="radiogroup" aria-label="Pacchetto di crediti" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {PACKAGES.map((pkg) => {
            const isSelected = selectedPack === pkg.id;
            return (
              <button
                key={pkg.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setSelectedPack(pkg.id)}
                className={`flex flex-col justify-between rounded-xl border bg-surface p-4 text-left transition-colors ${
                  isSelected ? 'border-accent' : 'border-line hover:border-line-strong'
                }`}
              >
                <span>
                  <span className="mb-1 block text-xs font-medium text-ink-muted">{pkg.name}</span>
                  <span className="mb-1.5 block title-display text-display-md tabular-nums text-ink">{pkg.price}</span>
                  <span className="mb-2 block text-xs text-ink-muted">+{pkg.credits} crediti</span>
                  <span className="block text-xs leading-snug text-ink-dim">{pkg.description}</span>
                </span>

                {/* Lo stato «Selezionato» era `bg-zinc-100 text-ink`: testo #F8FAFC
                    su fondo #F4F4F5, contrasto 1,03:1 — illeggibile. Ed era lo
                    stato predefinito del pacchetto consigliato, quindi lo vedeva
                    cosi' chiunque aprisse l'acquisto. Ora usa l'accento del
                    sistema, con testo bianco sopra. */}
                <span className={`mt-3 flex w-full items-center justify-center gap-1 rounded-lg border py-1.5 text-xs font-medium ${
                  isSelected
                    ? 'border-accent bg-accent text-white'
                    : 'border-line bg-surface text-ink-muted'
                }`}>
                  {isSelected && <Check className="h-3 w-3" aria-hidden="true" />}
                  {isSelected ? 'Selezionato' : 'Scegli'}
                </span>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-line text-xs">
          {/* Il marchio Stripe compare solo quando Stripe è davvero coinvolto:
              mostrarlo su un percorso simulato era una dichiarazione falsa. */}
          <span className="flex items-center gap-1 text-xs text-ink-dim">
            <ShieldCheck className="w-3.5 h-3.5 text-ink-muted" />
            {/* La fonte e' il server, non la presenza di una chiave nel client:
                sono due informazioni diverse, e usare la seconda faceva
                comparire il marchio Stripe su un pagamento simulato. */}
            {paymentsMode === 'live' ? 'Pagamento sicuro con Stripe' : 'Modalità sviluppo — nessun pagamento reale'}
          </span>

          <button
            onClick={handleCheckout}
            disabled={loading}
            id="confirm-checkout-btn"
            className="btn-primary flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {loading ? 'Elaborazione…' : `Acquista ${selectedPackage.price}`}
          </button>
        </div>
        </>
        )}
      </div>
    </Modal>
  );
}
