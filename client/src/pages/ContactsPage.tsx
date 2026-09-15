import { Link } from 'react-router-dom';
import { Mail, ShieldAlert, MessageSquareWarning, Scale } from 'lucide-react';
import MarketingLayout from '../components/MarketingLayout';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/**
 * Contatti.
 *
 * Un solo indirizzo, e non quattro alias che rimbalzano sulla stessa casella:
 * il prodotto non ha ancora un dominio proprio, quindi inventare
 * `privacy@`, `legal@` e `security@` significherebbe pubblicare tre recapiti
 * che non esistono. Meglio uno che funziona, con scritto accanto per che cosa
 * usarlo.
 *
 * Il TITOLARE DEL TRATTAMENTO manca ancora, ed è un obbligo di legge oltre che
 * una condizione per aprire un conto Stripe: qui c'è un riquadro che lo
 * dichiara apertamente invece di lasciare un vuoto. Dichiarare una lacuna è
 * meno grave che nasconderla, e soprattutto è visibile a chi deve colmarla.
 */
const RECAPITO = 'mohamedbakloul998@gmail.com';

export default function ContactsPage() {
  useDocumentTitle('Contatti');

  const motivi = [
    {
      icona: MessageSquareWarning,
      titolo: 'Un problema, un’idea, una domanda',
      testo: 'Anche dall’applicazione, con «Dicci cosa ne pensi» nella barra laterale: arriva nello stesso posto, con qualche informazione tecnica in più che aiuta a capire cosa è successo.'
    },
    {
      icona: ShieldAlert,
      titolo: 'Una vulnerabilità',
      testo: 'Descrizione, passi per riprodurla, impatto atteso. Nessuna segnalazione fatta in buona fede porta a conseguenze legali. Non pubblicare i dettagli finché non è corretta, e non usare l’accesso ottenuto per leggere dati di altre persone: una prova sul tuo account basta.'
    },
    {
      icona: Scale,
      titolo: 'I tuoi dati',
      testo: 'Accesso, rettifica, cancellazione, portabilità, opposizione. Rispondiamo entro un mese, come previsto dall’art. 12 GDPR. Molte di queste cose puoi farle da solo dalle impostazioni, subito e senza chiedere.'
    }
  ];

  return (
    <MarketingLayout>
      <div className="mx-auto w-full max-w-3xl px-5 py-16 md:px-8 md:py-24">
        <p className="eyebrow mb-5">Contatti</p>
        <h1 className="title-display text-display-lg">Scrivere a una persona</h1>

        <a
          href={`mailto:${RECAPITO}`}
          className="mt-10 inline-flex items-center gap-3 rounded-lg border border-line-control px-5 py-4 text-base text-ink transition-colors hover:border-ink-dim"
        >
          <Mail className="h-5 w-5 text-accent-glow" aria-hidden="true" />
          {RECAPITO}
        </a>

        <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-muted">
          È un indirizzo personale, non una casella automatica: il prodotto non ha ancora un dominio
          proprio, e preferiamo un recapito che funziona a tre alias che rimbalzano.
        </p>

        <div className="mt-16 space-y-12">
          {motivi.map(({ icona: Icona, titolo, testo }) => (
            <section key={titolo} className="rule pt-8">
              <h2 className="title-display flex items-center gap-2.5 text-display-sm">
                <Icona className="h-5 w-5 text-ink-dim" aria-hidden="true" /> {titolo}
              </h2>
              <p className="mt-3 text-base leading-relaxed text-ink-muted">{testo}</p>
            </section>
          ))}
        </div>

        {/* Vedi il commento in testa al file: una lacuna dichiarata è meno
            grave di una nascosta, e resta visibile a chi deve colmarla. */}
        <div className="mt-16 rounded-lg border border-warning/40 bg-warning/10 p-5">
          <h2 className="text-sm font-semibold text-ink">Titolare del trattamento</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Non ancora indicato. Prima dell’apertura al pubblico qui compariranno denominazione,
            sede e partita IVA di chi risponde giuridicamente del trattamento dei dati: è un obbligo
            degli articoli 13 e 14 del GDPR, ed è anche la condizione per poter incassare pagamenti.
            Fino ad allora il servizio resta in beta chiusa.
          </p>
        </div>

        <p className="mt-10 text-sm text-ink-dim">
          Vedi anche{' '}
          <Link to="/privacy" className="text-accent-glow underline underline-offset-2">
            l’informativa sulla privacy
          </Link>{' '}
          e{' '}
          <Link to="/terms" className="text-accent-glow underline underline-offset-2">
            i termini di servizio
          </Link>
          .
        </p>
      </div>
    </MarketingLayout>
  );
}
