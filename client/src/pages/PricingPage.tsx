import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import api from '../services/api';
import { useStore } from '../store/useStore';
import MarketingLayout from '../components/MarketingLayout';
import { Button, ButtonLink } from '../components/ui/Button';
import { useDocumentTitle } from '../lib/useDocumentTitle';

interface Pacchetto {
  credits: number;
  amount: number;
  currency: string;
  name: string;
}

const euro = (centesimi: number, valuta = 'EUR') =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: valuta.toUpperCase() }).format(centesimi / 100);

/**
 * Prezzi.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IL LISTINO SI LEGGE DAL SERVER, non si ricopia qui.
 *
 * È l'unico modo per cui questa pagina non può mentire. Un listino scritto due
 * volte diverge alla prima variazione, e diverge in silenzio: il cliente legge
 * un prezzo, ne paga un altro, e il primo a scoprirlo è lui. `GET
 * /payments/packages` è già la fonte per il modale d'acquisto — qui si usa la
 * stessa.
 *
 * E se i pagamenti sono SPENTI, quell'endpoint risponde 404 (`requireFeature`).
 * Non è un errore da nascondere: è l'informazione. La pagina lo dice —
 * «durante la beta è gratis» — invece di mostrare un listino per qualcosa che
 * nessuno può comprare, che è il modo più rapido di far sembrare finto un
 * prodotto vero.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function PricingPage() {
  useDocumentTitle('Prezzi');
  const { user, setAuthModalOpen, features } = useStore();
  const [pacchetti, setPacchetti] = useState<Record<string, Pacchetto> | null>(null);
  const [stato, setStato] = useState<'attesa' | 'pronto' | 'spento'>('attesa');

  useEffect(() => {
    if (!features.payments) {
      setStato('spento');
      return;
    }
    api
      .get('/payments/packages')
      .then((res) => {
        setPacchetti(res.data);
        setStato('pronto');
      })
      .catch(() => setStato('spento'));
  }, [features.payments]);

  const incluso = [
    'Conversazioni illimitate con i personaggi del catalogo',
    'Personaggi tuoi, privati o pubblicati',
    'Esportazione dei dati e cancellazione dell’account',
    'Nessuna pubblicità e nessuna profilazione'
  ];

  return (
    <MarketingLayout>
      <div className="mx-auto w-full max-w-[76rem] px-5 py-16 md:px-8 md:py-24">
        <p className="eyebrow mb-5">Quanto costa</p>
        <h1 className="title-display max-w-[18ch] text-display-lg">
          {stato === 'spento' ? 'Durante la beta è gratis' : 'Paghi solo i messaggi che mandi'}
        </h1>

        {stato === 'spento' ? (
          <>
            <p className="mt-7 max-w-2xl text-read text-ink-muted">
              I pagamenti non sono attivi. Alla registrazione ricevi dei crediti e non c'è nulla da
              acquistare: quando ci sarà, questa pagina mostrerà il listino vero, letto dal server
              e non ricopiato a mano.
            </p>

            <div className="rule mt-16 pt-10">
              <h2 className="title-display text-display-md">Che cosa comprende</h2>
              <ul className="mt-8 grid gap-4 sm:grid-cols-2">
                {incluso.map((v) => (
                  <li key={v} className="flex items-start gap-3 text-base text-ink-muted">
                    <Check className="mt-1 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                    {v}
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <>
            <p className="mt-7 max-w-2xl text-read text-ink-muted">
              Nessun abbonamento obbligatorio: i crediti si comprano una volta e restano finché non
              li usi. Un messaggio costa un credito.
            </p>

            <div className="mt-14 grid gap-5 md:grid-cols-3">
              {Object.entries(pacchetti ?? {}).map(([id, p]) => (
                <div key={id} className="rounded-lg border border-line bg-surface p-6">
                  <p className="eyebrow">{p.credits} crediti</p>
                  <p className="title-display tabular mt-3 text-display-md">
                    {euro(p.amount, p.currency)}
                  </p>
                  <p className="mt-2 text-sm text-ink-dim">
                    {euro(Math.round(p.amount / p.credits), p.currency)} a messaggio
                  </p>
                </div>
              ))}
            </div>

            <p className="mt-6 text-sm text-ink-dim">
              Prezzi IVA inclusa. La ricevuta è disponibile nelle impostazioni dopo ogni acquisto.
            </p>
          </>
        )}

        <div className="rule mt-16 flex flex-col items-start gap-5 pt-10 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-base text-ink-muted">
            {user ? 'Hai già un account.' : 'Serve un account per cominciare.'}
          </p>
          {user ? (
            <ButtonLink to="/discover" variant="primary">Vai all'app</ButtonLink>
          ) : (
            <Button variant="primary" onClick={() => setAuthModalOpen(true, 'register')}>
              Crea un account
            </Button>
          )}
        </div>
      </div>
    </MarketingLayout>
  );
}
