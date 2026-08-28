import { useState } from 'react';
import { Star, Send, Check, MessageSquareHeart } from 'lucide-react';
import api from '../services/api';
import { useStore } from '../store/useStore';
import Modal from './ui/Modal';

/**
 * Canale con cui gli utenti della beta dicono che cosa pensano.
 *
 * Si apre in due modi molto diversi:
 *  · «review» — l'utente lo cerca da sé, quando ha qualcosa da dire;
 *  · «wants_more» — compare da solo quando i crediti finiscono.
 *
 * Il secondo caso è il più importante di tutta la beta. È il momento in cui una
 * persona vorrebbe continuare e non può: invece di lasciarla davanti a un
 * vicolo cieco, le si chiede se vuole essere avvisata. Quel gesto è il segnale
 * più vicino a una disponibilità a pagare che si possa raccogliere senza
 * chiedere una carta.
 */
export default function FeedbackModal() {
  const { isFeedbackModalOpen, feedbackKind, setFeedbackModalOpen, notify } = useStore();

  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const wantsMore = feedbackKind === 'wants_more';

  const close = () => {
    setFeedbackModalOpen(false);
    // Si azzera dopo la chiusura, non prima: svuotare i campi mentre la
    // finestra è ancora visibile la fa "lampeggiare" vuota.
    setTimeout(() => { setRating(0); setMessage(''); setDone(false); }, 200);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/feedback', {
        type: feedbackKind,
        rating: rating || undefined,
        message: message.trim() || undefined
      });
      setDone(true);
      setTimeout(close, 2200);
    } catch (err: any) {
      notify(err.response?.data?.error ?? 'Non siamo riusciti a inviare. Riprova.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = wantsMore || rating > 0 || message.trim().length > 0;

  return (
    <Modal
      open={isFeedbackModalOpen}
      onClose={close}
      title={wantsMore ? 'Hai finito i crediti' : 'Dicci cosa ne pensi'}
    >
      {done ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Check className="h-8 w-8 text-success" aria-hidden="true" />
          <p className="text-sm text-ink">
            {wantsMore
              ? 'Perfetto. Ti scriviamo appena puoi continuare.'
              : 'Grazie. Leggiamo tutto quello che arriva.'}
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          {wantsMore ? (
            <div className="flex gap-3 rounded-xl border border-line bg-surface p-4">
              <MessageSquareHeart className="mt-0.5 h-5 w-5 shrink-0 text-sapphire-glow" aria-hidden="true" />
              <div className="space-y-1.5 text-sm leading-relaxed text-ink-muted">
                <p className="font-medium text-ink">Durante la beta non è ancora possibile ricaricare.</p>
                <p>
                  Se vuoi continuare, dimmelo qui: ti scrivo appena apro i pagamenti, e
                  chi ha provato la beta parte con crediti in regalo.
                </p>
              </div>
            </div>
          ) : (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-ink">Quanto ti è piaciuta?</legend>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    aria-label={`${n} su 5`}
                    aria-pressed={rating === n}
                    className="rounded-lg p-1.5 transition-colors hover:bg-surface"
                  >
                    <Star
                      className={`h-6 w-6 transition-colors ${
                        n <= rating ? 'fill-warning text-warning' : 'text-ink-dim'
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <div>
            <label htmlFor="feedback-text" className="mb-1.5 block text-sm font-medium text-ink">
              {wantsMore ? 'Vuoi aggiungere qualcosa? (facoltativo)' : 'Cosa miglioreresti?'}
            </label>
            <textarea
              id="feedback-text"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
              placeholder={
                wantsMore
                  ? 'Che personaggio ti è piaciuto di più? Cosa ti manca?'
                  : 'Anche una riga sola è utile. Le leggo tutte.'
              }
              className="input-field resize-y"
            />
            <p className="mt-1 text-right font-mono text-[10px] text-ink-dim">{message.length}/2000</p>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
            <button type="button" onClick={close} className="btn-secondary rounded-xl px-4 py-2 text-sm">
              Non ora
            </button>
            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="btn-primary flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              {loading ? 'Invio…' : wantsMore ? 'Avvisami' : 'Invia'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
