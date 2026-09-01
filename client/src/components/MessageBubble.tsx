import { useState } from 'react';
import { Copy, RefreshCw, Trash2, ShieldAlert, Check, AlertTriangle, Sparkles, LifeBuoy } from 'lucide-react';
import Avatar from './ui/Avatar';
import { parseMessage } from '../lib/format';
import type { Character, Message } from '../store/useStore';

interface Props {
  message: Message;
  character: Character;
  isLast: boolean;
  streaming?: boolean;
  onRegenerate?: () => void;
  onDelete?: (id: string) => void;
  onReport?: (id: string) => void;
}

export default function MessageBubble({
  message, character, isLast, streaming, onRegenerate, onDelete, onReport
}: Props) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const isError = message.error === true;
  // Un avviso di sicurezza non è un turno del personaggio: va mostrato come
  // parola della piattaforma, altrimenti sembrerebbe che sia il personaggio a
  // rifiutare — o peggio, che i numeri di aiuto siano parte della finzione.
  const isSafety = message.safetyNotice === true;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* Appunti non disponibili: nessun feedback fuorviante. */
    }
  };

  const action = (label: string, Icon: typeof Copy, onClick: () => void) => (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="btn-ghost rounded-lg p-1.5 hover-action"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );

  return (
    <div className={`group flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {!isUser && !isSafety && (
        <Avatar src={character.avatar} name={character.name} size={30} rounded="md" className="portrait mt-1" />
      )}
      {!isUser && isSafety && (
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-warning/40 bg-warning/10">
          <LifeBuoy className="h-4 w-4 text-warning" aria-hidden="true" />
        </span>
      )}

      {/**
        * Misure diverse per i due ruoli.
        *
        * Il turno del personaggio è prosa da leggere: gli si dà una GIUSTEZZA,
        * cioè una larghezza di riga misurata in caratteri e non in percentuale
        * della finestra. `65ch` è l'intervallo in cui l'occhio ritrova l'inizio
        * della riga successiva senza cercarlo — la regola tipografica di
        * sempre. Con `max-w-[75%]` su uno schermo largo le righe arrivavano a
        * centoventi caratteri, e si perde il segno.
        *
        * Il turno dell'utente resta stretto: è una battuta, non un brano.
        */}
      <div className={`flex min-w-0 flex-col gap-1.5 ${isUser ? 'max-w-[80%] items-end md:max-w-[60%]' : 'max-w-[65ch] items-start'}`}>
        {/**
          * IL TURNO DEL PERSONAGGIO NON È UNA BOLLA.
          *
          * È la decisione che porta più lontano da un'interfaccia di chat
          * qualunque, ed è la più giustificata dal prodotto: qui si legge un
          * personaggio che parla, non si consultano notifiche. Un romanzo non
          * mette il dialogo dentro dei riquadri colorati.
          *
          * Quindi: nessun fondo, nessun contorno, nessun angolo arrotondato.
          * Solo testo — serif, 16px, interlinea 1.7 — appoggiato alla pagina.
          * Prima era un rettangolo grigio con testo a 15px, cioè la stessa
          * forma con cui l'interfaccia disegna un pannello di impostazioni.
          *
          * Il turno dell'UTENTE conserva un contenitore, perché lì il riquadro
          * fa un lavoro vero: separa ciò che hai scritto da ciò che stai
          * leggendo. Ma non è più azzurro pieno. In una conversazione di
          * quaranta turni erano venti blocchi di accento, e il colore che
          * l'interfaccia riserva alle AZIONI finiva addosso a ogni frase.
          *
          * Restano colorati solo gli stati che portano un significato:
          * l'errore e l'avviso di sicurezza. È l'unico posto in cui il colore
          * dice qualcosa che il testo da solo non direbbe.
          */}
        <div
          className={
            isUser
              ? 'rounded-lg rounded-tr-sm bg-surface px-4 py-2.5 text-base text-ink-muted'
              : isError
                ? 'border-l-2 border-danger py-1 pl-4 text-base text-danger'
                : isSafety
                  ? 'border-l-2 border-warning py-1 pl-4 text-base text-ink'
                  : 'font-display text-read text-ink'
          }
        >
          {isError && (
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Risposta non riuscita
            </p>
          )}

          {isSafety && (
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-warning">
              <LifeBuoy className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Messaggio di your-character, non del personaggio
            </p>
          )}

          {message.simulated && (
            <p className="mb-1.5 flex items-center gap-1.5 text-micro font-medium text-warning">
              <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
              Risposta simulata — nessun credito addebitato
            </p>
          )}

          {/* Gli a-capo vengono preservati e le *azioni narrative* rese in
              corsivo: prima il testo collassava in un unico paragrafo e gli
              asterischi restavano visibili (S3-15). */}
          <p className="whitespace-pre-wrap break-words">
            {parseMessage(message.content).map((part, i) =>
              part.italic ? (
                <em key={i} className={isUser ? 'text-ink-dim' : 'text-ink-muted'}>{part.text}</em>
              ) : (
                <span key={i}>{part.text}</span>
              )
            )}
            {streaming && (
              <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-current align-middle" aria-hidden="true" />
            )}
          </p>

          {message.image && (
            <figure className="mt-3 overflow-hidden rounded-lg">
              <img src={message.image.url} alt={message.image.prompt} className="max-h-96 w-full object-cover" loading="lazy" />
              <figcaption className="bg-bg px-3 py-2 text-micro text-ink-dim">
                {message.image.prompt}
              </figcaption>
            </figure>
          )}
        </div>

        <div className={`flex items-center gap-0.5 ${isUser ? 'flex-row-reverse' : ''}`}>
          <time className="tabular px-1 text-micro text-ink-dim" dateTime={message.createdAt}>
            {new Date(message.createdAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
          </time>

          {!streaming && !message.pending && (
            <>
              {action(copied ? 'Copiato' : 'Copia', copied ? Check : Copy, copy)}
              {!isUser && isLast && !isSafety && onRegenerate && action('Rigenera risposta', RefreshCw, onRegenerate)}
              {!isUser && !isSafety && onReport && action('Segnala messaggio', ShieldAlert, () => onReport(message._id))}
              {onDelete && action('Elimina messaggio', Trash2, () => onDelete(message._id))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
