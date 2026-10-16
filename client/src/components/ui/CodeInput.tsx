import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

/**
 * Il campo per un codice di conferma.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Sei caselle invece di un campo unico, e non è decorazione: dicono quanto è
 * lungo il codice prima che l'utente cominci a scriverlo, e rendono evidente a
 * colpo d'occhio quante cifre mancano. È l'unico posto dell'interfaccia dove
 * frammentare un valore in più campi aiuta invece di infastidire, perché il
 * valore È una sequenza di cifre indipendenti.
 *
 * Le tre cose che di solito si sbagliano, e che qui sono gestite:
 *
 *  · INCOLLARE. Chi riceve un codice per email lo copia, non lo ricopia a
 *    mano. Senza `onPaste`, incollare «123456» riempirebbe solo la prima
 *    casella — e sarebbe esattamente il gesto più comune a non funzionare.
 *
 *  · CANCELLARE. `Backspace` su una casella vuota torna indietro e cancella
 *    quella prima. Senza, dopo un errore bisogna riposizionarsi col mouse.
 *
 *  · IL CAMPO RESTA UNO SOLO per la tastiera e per i lettori di schermo: un
 *    solo `aria-label` sul gruppo, `inputMode="numeric"` per far comparire il
 *    tastierino sul telefono, e `autoComplete="one-time-code"` perché iOS e
 *    Android sappiano offrire il codice appena arrivato via SMS o email.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
  length = 6,
  invalid
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  disabled?: boolean;
  length?: number;
  invalid?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  const cifre = value.padEnd(length, ' ').slice(0, length).split('');

  const scrivi = (nuovo: string) => {
    const pulito = nuovo.replace(/\D/g, '').slice(0, length);
    onChange(pulito);
    if (pulito.length === length) onComplete?.(pulito);
    return pulito;
  };

  const onCasella = (indice: number, testo: string) => {
    // Una casella può ricevere più cifre: digitazione rapida, o un incolla che
    // il browser consegna come input invece che come evento di incolla.
    const cifreNuove = testo.replace(/\D/g, '');
    if (!cifreNuove) return;

    const attuale = value.split('');
    for (let i = 0; i < cifreNuove.length && indice + i < length; i++) {
      attuale[indice + i] = cifreNuove[i];
    }
    const composto = scrivi(attuale.join('').replace(/\s/g, ''));

    const prossimo = Math.min(indice + cifreNuove.length, length - 1);
    if (composto.length < length) refs.current[prossimo]?.focus();
  };

  const onTasto = (indice: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const attuale = value.split('');
      if (attuale[indice]) {
        attuale[indice] = '';
        onChange(attuale.join('').trimEnd());
      } else if (indice > 0) {
        attuale[indice - 1] = '';
        onChange(attuale.join('').trimEnd());
        refs.current[indice - 1]?.focus();
      }
      return;
    }
    if (e.key === 'ArrowLeft' && indice > 0) { e.preventDefault(); refs.current[indice - 1]?.focus(); }
    if (e.key === 'ArrowRight' && indice < length - 1) { e.preventDefault(); refs.current[indice + 1]?.focus(); }
  };

  const onIncolla = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const composto = scrivi(e.clipboardData.getData('text'));
    refs.current[Math.min(composto.length, length - 1)]?.focus();
  };

  return (
    <div
      role="group"
      aria-label={`Codice di conferma a ${length} cifre`}
      className="flex justify-center gap-2"
    >
      {cifre.map((cifra, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          disabled={disabled}
          aria-label={`Cifra ${i + 1}`}
          aria-invalid={invalid || undefined}
          value={cifra.trim()}
          onChange={(e) => onCasella(i, e.target.value)}
          onKeyDown={(e) => onTasto(i, e)}
          onPaste={onIncolla}
          onFocus={(e) => e.target.select()}
          className={`h-14 w-11 rounded-md border bg-surface-sunken text-center font-mono text-display-sm
                      text-ink transition-colors disabled:opacity-40
                      ${invalid ? 'border-danger' : 'border-line-control focus:border-accent'}`}
        />
      ))}
    </div>
  );
}
