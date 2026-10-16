import { Navigate } from 'react-router-dom';
import { PenLine, MessagesSquare, ShieldCheck, EyeOff, Sparkles } from 'lucide-react';
import { useStore } from '../store/useStore';
import MarketingLayout from '../components/MarketingLayout';
import { Button, ButtonLink } from '../components/ui/Button';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/**
 * La porta d'ingresso.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `/` era il catalogo: chi arrivava senza sapere cosa fosse `your-character`
 * trovava una griglia di volti sconosciuti e nessuna frase che lo spiegasse.
 *
 * OGNI AFFERMAZIONE QUI DENTRO DEVE ESSERE VERA, e verificabile aprendo il
 * codice o l'informativa. È la ragione per cui non c'è scritto «i tuoi dati
 * non escono mai»: non è vero, il testo delle conversazioni va a Google per
 * generare la risposta, e l'informativa lo dice in cima. Una promessa gonfiata
 * in home page è la cosa che un utente scopre per prima e non perdona.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function LandingPage() {
  useDocumentTitle('Crea un personaggio e conversaci');
  const { user, isAuthResolved, setAuthModalOpen, inviteRequired, features } = useStore();

  /**
   * Chi è già connesso non ha bisogno della vetrina.
   *
   * Si aspetta che la sessione sia RISOLTA prima di decidere: senza,
   * l'utente connesso vedrebbe la presentazione per un istante e poi verrebbe
   * spostato — uno sfarfallio a ogni caricamento della radice.
   */
  if (isAuthResolved && user) return <Navigate to="/discover" replace />;

  const passi = [
    {
      icona: PenLine,
      titolo: 'Descrivi chi vuoi incontrare',
      testo:
        'Un nome, un carattere, una storia alle spalle. Bastano poche righe: sono quelle a decidere come parlerà.'
    },
    {
      icona: MessagesSquare,
      titolo: 'Conversaci',
      testo:
        'Il personaggio ricorda quello che vi siete detti e resta nella sua parte. Puoi correggere il tiro o rigenerare una risposta quando non convince.'
    },
    {
      icona: Sparkles,
      titolo: 'Tienilo per te, o pubblicalo',
      testo:
        'Un personaggio privato lo vedi solo tu. Se lo rendi pubblico entra in catalogo e chiunque può parlarci.'
    }
  ];

  return (
    <MarketingLayout>
      {/* ── Apertura ────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-[76rem] px-5 pb-20 pt-16 md:px-8 md:pb-28 md:pt-24">
        <p className="eyebrow mb-5">Conversazioni con personaggi scritti da te</p>
        <h1 className="title-display max-w-[16ch] text-display-lg md:text-display-xl">
          Scegli con chi parlare
        </h1>
        <p className="mt-7 max-w-2xl text-read text-ink-muted">
          Crea un personaggio, dagli una personalità e conversaci. Nessuna pubblicità, nessuna
          profilazione: quello che vi dite serve a far funzionare la conversazione e a nient'altro.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Button size="lg" variant="primary" onClick={() => setAuthModalOpen(true, 'register')}>
            Crea un account
          </Button>
          <ButtonLink to="/discover" size="lg">
            Guarda il catalogo
          </ButtonLink>
        </div>

        {/* La beta è chiusa solo se il server dice che lo è: la vetrina non
            deve annunciare un cancello che potrebbe non esserci. */}
        {inviteRequired && (
          <p className="mt-5 text-sm text-ink-dim">
            La beta è su invito: per registrarti serve un codice.
          </p>
        )}
      </section>

      {/* ── Come funziona ───────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-[76rem] px-5 md:px-8">
        <div className="rule pt-10">
          <h2 className="title-display text-display-md">Come funziona</h2>
          <div className="mt-12 grid gap-x-10 gap-y-12 md:grid-cols-3">
            {passi.map(({ icona: Icona, titolo, testo }, i) => (
              <div key={titolo}>
                <div className="flex items-center gap-3">
                  <Icona className="h-5 w-5 text-accent-glow" aria-hidden="true" />
                  <span className="eyebrow tabular">0{i + 1}</span>
                </div>
                <h3 className="title-display mt-4 text-display-sm">{titolo}</h3>
                <p className="mt-3 text-base leading-relaxed text-ink-muted">{testo}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Che cosa promettiamo davvero ────────────────────────────────── */}
      <section className="mx-auto w-full max-w-[76rem] px-5 pt-24 md:px-8">
        <div className="rule pt-10">
          <h2 className="title-display text-display-md">Quello che possiamo promettere</h2>
          <p className="mt-4 max-w-2xl text-base text-ink-muted">
            Solo cose verificabili: ognuna di queste righe corrisponde a qualcosa che sta scritto
            nell'informativa o nel codice.
          </p>

          <div className="mt-12 grid gap-x-10 gap-y-12 md:grid-cols-3">
            <div>
              <EyeOff className="h-5 w-5 text-ink-dim" aria-hidden="true" />
              <h3 className="title-display mt-4 text-display-sm">Nessuna pubblicità</h3>
              <p className="mt-3 text-base leading-relaxed text-ink-muted">
                Non ci sono inserzionisti, quindi non c'è niente da profilare. Le conversazioni non
                vengono usate per addestrare modelli.
              </p>
            </div>
            <div>
              <ShieldCheck className="h-5 w-5 text-ink-dim" aria-hidden="true" />
              <h3 className="title-display mt-4 text-display-sm">Moderazione, non sorveglianza</h3>
              <p className="mt-3 text-base leading-relaxed text-ink-muted">
                Filtri automatici sui contenuti vietati, e una coda di revisione per i personaggi
                pubblicati. Nessuno legge le tue conversazioni private per curiosità.
              </p>
            </div>
            <div>
              <MessagesSquare className="h-5 w-5 text-ink-dim" aria-hidden="true" />
              <h3 className="title-display mt-4 text-display-sm">Puoi portarti via tutto</h3>
              <p className="mt-3 text-base leading-relaxed text-ink-muted">
                Esportazione completa dei tuoi dati e cancellazione definitiva dell'account, dalle
                impostazioni, senza doverlo chiedere a nessuno.
              </p>
            </div>
          </div>

          {/**
            * La riga che quasi nessuno scrive in home page, ed è quella che
            * conta: dove finisce davvero il testo. Sta qui perché scoprirlo
            * dopo l'iscrizione è il modo migliore per perdere la fiducia di
            * qualcuno.
            */}
          <p className="mt-12 max-w-3xl rounded-lg border border-line bg-surface p-5 text-sm leading-relaxed text-ink-muted">
            <strong className="text-ink">Dove va quello che scrivi.</strong> Per generare le
            risposte, il testo della conversazione viene inviato a Google (Gemini). È l'unico
            trasferimento che avviene, ed è spiegato per intero{' '}
            <a href="/privacy" className="text-accent-glow underline underline-offset-2">
              nell'informativa sulla privacy
            </a>
            .
          </p>
        </div>
      </section>

      {/* ── Chiusura ────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-[76rem] px-5 pt-24 md:px-8">
        <div className="rule flex flex-col items-start gap-6 pt-10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="title-display text-display-md">Comincia da un personaggio</h2>
            <p className="mt-3 max-w-xl text-base text-ink-muted">
              {features.payments
                ? 'Ricevi crediti alla registrazione: bastano per capire se fa per te.'
                : 'Durante la beta è gratis, e non ci sono pagamenti attivi.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" variant="primary" onClick={() => setAuthModalOpen(true, 'register')}>
              Crea un account
            </Button>
            <ButtonLink to="/discover" size="lg">
              Guarda il catalogo
            </ButtonLink>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
