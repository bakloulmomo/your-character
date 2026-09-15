import { Link } from 'react-router-dom';
import MarketingLayout from '../components/MarketingLayout';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/**
 * Le domande che arrivano davvero.
 *
 * Non è una pagina di riempimento: ogni risposta qui sotto corrisponde a un
 * comportamento che il codice ha davvero, e diverse rimandano all'informativa
 * o ai termini invece di riassumerli male. Una FAQ che parafrasa un documento
 * legale crea una seconda versione della verità, e quando le due divergono
 * vale quella che l'utente ha letto per prima.
 */
const DOMANDE: Array<{ d: string; r: React.ReactNode }> = [
  {
    d: 'Che cos’è, esattamente?',
    r: (
      <>
        Un posto dove scrivere un personaggio — nome, carattere, storia — e poi conversarci. Le
        risposte le genera un sistema di intelligenza artificiale a partire da quella descrizione.
        Non c’è nessuna persona dall’altra parte, e i personaggi non sono consulenti: né medici, né
        avvocati, né terapeuti.
      </>
    )
  },
  {
    d: 'Chi può vedere i personaggi che creo?',
    r: (
      <>
        Dipende da te. Un personaggio <strong className="text-ink">privato</strong> lo vedi solo tu.
        Uno <strong className="text-ink">pubblico</strong> entra nel catalogo appena lo crei e
        chiunque può parlarci; un moderatore lo esamina dopo, e può rimuoverlo se viola le regole.
        Le <em>conversazioni</em> restano private in ogni caso: pubblicare un personaggio non
        pubblica ciò che ti sei detto con lui.
      </>
    )
  },
  {
    d: 'Dove finisce il testo che scrivo?',
    r: (
      <>
        Per generare la risposta, il testo della conversazione viene inviato a Google (Gemini). È
        l’unico trasferimento che avviene per far funzionare la chat, e{' '}
        <Link to="/privacy" className="text-accent-glow underline underline-offset-2">
          l’informativa
        </Link>{' '}
        lo dice in cima invece che in fondo. Le conversazioni non vengono vendute né usate per
        addestrare modelli.
      </>
    )
  },
  {
    d: 'Qualcuno legge le mie conversazioni?',
    r: (
      <>
        No, non per curiosità e non a campione. Esiste un filtro automatico che intercetta contenuti
        vietati, e un contenuto <em>segnalato</em> — da te o dal filtro — può essere letto da chi
        modera, limitatamente al frammento segnalato. È l’unico caso.
      </>
    )
  },
  {
    d: 'Posso cancellare tutto?',
    r: (
      <>
        Sì, dalle impostazioni: esportazione completa dei dati in un file, e cancellazione
        definitiva dell’account senza doverla chiedere a nessuno. Restano solo i documenti che la
        legge obbliga a conservare, cioè le ricevute fiscali di eventuali acquisti — e da quelle
        spariscono i dati personali non necessari.
      </>
    )
  },
  {
    d: 'Perché mi chiede di confermare l’email?',
    r: (
      <>
        Perché senza conferma chiunque potrebbe registrarsi con l’indirizzo di un altro. Il codice
        arriva per posta, dura quindici minuti, e finché non lo inserisci puoi guardare il catalogo
        ma non scrivere. Se non arriva, controlla la posta indesiderata: il mittente è un indirizzo
        personale e non un dominio dedicato, quindi capita.
      </>
    )
  },
  {
    d: 'Quanti anni bisogna avere?',
    r: (
      <>
        Diciotto. È scritto nei{' '}
        <Link to="/terms" className="text-accent-glow underline underline-offset-2">
          termini
        </Link>
        , e la data di nascita viene chiesta alla registrazione.
      </>
    )
  },
  {
    d: 'Il personaggio si è comportato male. Che faccio?',
    r: (
      <>
        Ogni messaggio e ogni personaggio hanno un comando «Segnala». Le segnalazioni finiscono in
        una coda che una persona guarda, e un personaggio che viola le regole viene rimosso dal
        catalogo — modificarlo non lo rimette online.
      </>
    )
  },
  {
    d: 'Quanto costa?',
    r: (
      <>
        Durante la beta è gratuito.{' '}
        <Link to="/prezzi" className="text-accent-glow underline underline-offset-2">
          La pagina dei prezzi
        </Link>{' '}
        mostra il listino quando i pagamenti sono attivi, letto dal server e non ricopiato a mano.
      </>
    )
  }
];

export default function FaqPage() {
  useDocumentTitle('Domande frequenti');

  return (
    <MarketingLayout>
      <div className="mx-auto w-full max-w-3xl px-5 py-16 md:px-8 md:py-24">
        <p className="eyebrow mb-5">Domande frequenti</p>
        <h1 className="title-display text-display-lg">Le risposte, senza giri</h1>

        <dl className="mt-16 space-y-12">
          {DOMANDE.map(({ d, r }) => (
            <div key={d} className="rule pt-8">
              <dt className="title-display text-display-sm">{d}</dt>
              <dd className="mt-3 text-base leading-relaxed text-ink-muted">{r}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-16 text-sm text-ink-dim">
          Manca qualcosa?{' '}
          <Link to="/contatti" className="text-accent-glow underline underline-offset-2">
            Scrivici
          </Link>
          : le domande che tornano finiscono qui.
        </p>
      </div>
    </MarketingLayout>
  );
}
