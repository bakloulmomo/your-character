import { useState } from 'react';
import { X, ShieldAlert, Check } from 'lucide-react';
import { useStore } from '../store/useStore';
import api from '../services/api';

export default function ReportModal() {
  const { isReportModalOpen, setReportModalOpen, reportTarget } = useStore();
  const [reason, setReason] = useState('hate_speech');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [error, setError] = useState('');

  if (!isReportModalOpen || !reportTarget) return null;

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
      setTimeout(() => {
        setReportModalOpen(false);
        setSubmitted(false);
        setDuplicate(false);
        setDescription('');
      }, 2200);
    } catch (err: any) {
      console.error('Report error:', err);
      setError(err.response?.data?.error || 'Impossibile inviare la segnalazione.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-bg-elevated max-w-md w-full rounded-xl p-6 border border-line space-y-4 shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-ink-muted" />
            <h2 className="font-semibold text-ink text-xs">Segnala Contenuto</h2>
          </div>
          <button
            onClick={() => setReportModalOpen(false)}
            className="p-1 rounded text-ink-dim hover:text-ink-muted"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {submitted ? (
          <div className="p-6 text-center space-y-2">
            <Check className="w-6 h-6 text-ink-muted mx-auto" />
            <p className="text-xs text-ink-muted">
              {duplicate
                ? 'Avevi già segnalato questo contenuto: la segnalazione è in esame.'
                : 'Segnalazione inviata. Verrà esaminata dal team di moderazione.'}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {error && (
              <div className="p-3 rounded-md bg-danger/10 border border-danger/40 text-danger">
                {error}
              </div>
            )}

            <div>
              <label className="block text-ink-muted font-medium mb-1">Motivo *</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full bg-surface border border-line focus:border-line-strong rounded-md px-3 py-2 text-ink outline-none"
              >
                <option value="hate_speech">Incitamento all'odio o discriminazione</option>
                <option value="harassment">Molestie o bullismo</option>
                <option value="nsfw_unmarked">Contenuto esplicito non contrassegnato</option>
                <option value="copyright">Violazione copyright</option>
                <option value="spam">Spam o truffa</option>
                <option value="other">Altro</option>
              </select>
            </div>

            <div>
              <label className="block text-ink-muted font-medium mb-1">Dettagli (Opzionale)</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Fornisci ulteriori informazioni..."
                className="w-full bg-surface border border-line focus:border-line-strong rounded-md p-3 text-ink outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => setReportModalOpen(false)}
                className="btn-secondary px-3 py-1.5 rounded-md text-xs font-medium"
              >
                Annulla
              </button>
              <button
                type="submit"
                disabled={loading}
                id="submit-report-btn"
                className="btn-primary px-4 py-1.5 rounded-md text-xs font-medium"
              >
                {loading ? 'Invio...' : 'Invia Report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
