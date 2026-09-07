import { useStore } from '../../store/useStore';
import Modal from './Modal';
import { Button } from './Button';

/**
 * «Sei sicuro di voler eliminare…?»
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Prima esisteva in due punti su sei, scritta a mano ogni volta, e nei quattro
 * restanti non esisteva affatto: eliminare un messaggio, eliminare una
 * conversazione dal menu della barra laterale e disconnettersi avvenivano al
 * primo click, senza appello. Sono tre azioni che non si annullano, raggiunte
 * da voci di menu piccole e vicine ad altre voci.
 *
 * Montata una volta sola in `AppShell`, si apre da qualunque punto con
 * `askConfirm(...)`. Il vantaggio non è risparmiare righe: è che la
 * disposizione dei due pulsanti non può più cambiare da una schermata
 * all'altra. Un'interfaccia in cui il tasto distruttivo a volte è a destra e a
 * volte a sinistra insegna a non fidarsi della posizione, e a quel punto ogni
 * conferma diventa un click a caso.
 *
 * DISPOSIZIONE, fissa: rinuncia a SINISTRA, azione distruttiva a DESTRA e in
 * rosso. Il fuoco parte sulla rinuncia — `data-autofocus` — così Invio premuto
 * per riflesso annulla invece di cancellare.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ConfirmDialog() {
  const { confirmRequest, resolveConfirm } = useStore();

  const {
    title = '',
    description,
    confirmLabel = 'Cancella',
    cancelLabel = 'Annulla',
    destructive = true
  } = confirmRequest ?? {};

  return (
    <Modal
      open={!!confirmRequest}
      // Chiudere con Esc o dal velo equivale a rinunciare: il silenzio non può
      // valere come consenso a un'azione che non si annulla.
      onClose={() => resolveConfirm(false)}
      title={title}
      size="sm"
    >
      {description && <p className="text-sm leading-relaxed text-ink-muted">{description}</p>}

      <div className={`flex justify-end gap-2 ${description ? 'mt-6' : 'mt-2'}`}>
        <Button data-autofocus onClick={() => resolveConfirm(false)}>
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? 'danger-strong' : 'primary'}
          onClick={() => resolveConfirm(true)}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
