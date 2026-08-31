import { useState } from 'react';
import { Check, Send } from 'lucide-react';
import { useStore } from '../store/useStore';
import Modal from './ui/Modal';
import api from '../services/api';
import { errorMessage } from '../lib/apiError';

const REASONS = [
  { value: 'hate_speech', label: 'Incitamento all’odio o discriminazione' },
  { value: 'harassment', label: 'Molestie o bullismo' },
  { value: 'nsfw_unmarked', label: 'Contenuto esplicito non contrassegnato' },
  { value: 'copyright', label: 'Violazione di copyright' },
  { value: 'spam', label: 'Spam o truffa' },
  { value: 'other', label: 'Altro' }
];

const TARGET_LABEL = {
  character: 'questo personaggio',
  message: 'questo messaggio',
  user: 'questo utente'
} as const;

/**
 * Segnalazione di un contenuto.
 *
 * Usa il componente Modal condiviso invece di un overlay riscritto a mano.
 * Quello precedente non aveva `role="dialog"`, non si chiudeva con Esc, non
 * intrappolava il focus e non lo restituiva all'elemento di partenza: con la
 * tastiera era inutilizzabile. La correzione esisteva già nel progetto —
 * `ui/Modal.tsx`, scritto proprio per questo. Segnalare un contenuto è il
 * canale con cui gli utenti proteggono se stessi: deve funzionare per tutti.
 *
 * Il contenuto della finestra è stato riallineato al resto dell'interfaccia.
 * Era rimasto l'unico punto dell'app con il proprio dialetto visivo: testo a
 * `text-xs` invece di `text-sm`, angoli `rounded-lg` invece di `rounded-xl`,
 * campi costruiti a mano invece di `.input-field`, «Invia Report» e «Dettagli
 * (Opzionale)» in mezzo a un'interfaccia interamente in italiano. E le due
 * etichette non erano collegate ai rispettivi campi: per uno screen reader
 * questa finestra conteneva un menu a tendina e un'area di testo senza nome.
 */
export default function ReportModal() {
  const { isReportModalOpen, setReportModalOpen, reportTarget } = useStore();
  const [reason, setReason] = useState('hate_speech');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [error, setError] = useState('');

  if (!reportTarget) return null;

  const close = () => {
    setReportModalOpen(false);
    setSubmitted(false);
    setDuplicate(false);
    setDescription('');
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await api.post('/reports', {
        targetType: reportTarget.type,
        targetId: reportTarget.id,
        reason,
        description
      });
      // Il server deduplica le segnalazioni (S2-13): la seconda sullo stesso
      // bersaglio non è un errore, ma nemmeno una nuova segnalazione — e
      // dirlo evita che qualcuno insista pensando di non essere stato ascoltato.
      setDuplicate(res.data?.duplicate === true);
      setSubmitted(true);
      setTimeout(close, 2200);
    } catch (err: any) {
      setError(errorMessage(err, 'Impossibile inviare la segnalazione.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={isReportModalOpen} onClose={close} title="Segnala contenuto">
      {submitted ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Check className="h-8 w-8 text-success" aria-hidden="true" />
          <p className="text-sm text-ink">
            {duplicate
              ? 'Avevi già segnalato questo contenuto: la segnalazione è in esame.'
              : 'Segnalazione inviata. La esamina il team di moderazione.'}
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div role="alert" className="animate-shake rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          )}

          <p className="text-sm text-ink-muted">
            Stai segnalando {TARGET_LABEL[reportTarget.type]}. La segnalazione è anonima per chi la
            riceve e non avvisa l'autore.
          </p>

          <div>
            <label htmlFor="report-reason" className="mb-1.5 block text-sm font-medium text-ink">
              Motivo
            </label>
            <select
              id="report-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="input-field"
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="report-details" className="mb-1.5 block text-sm font-medium text-ink">
              Dettagli <span className="font-normal text-ink-dim">(facoltativi)</span>
            </label>
            <textarea
              id="report-details"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              placeholder="Che cosa è successo, e dove."
              className="input-field resize-y"
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
            <button type="button" onClick={close} className="btn-secondary rounded-xl px-4 py-2 text-sm">
              Annulla
            </button>
            <button
              type="submit"
              disabled={loading}
              id="submit-report-btn"
              className="btn-primary flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              {loading ? 'Invio…' : 'Invia segnalazione'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
