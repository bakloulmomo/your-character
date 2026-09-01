import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download, Trash2, Cookie, Loader2, ShieldCheck, EyeOff, Receipt, Globe2, CalendarClock
} from 'lucide-react';
import api from '../services/api';
import { useStore } from '../store/useStore';
import { EmptyState } from '../components/ui/States';
import Modal from '../components/ui/Modal';
import { CONSENT_VERSION, getConsent, setConsent } from '../lib/consent';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { errorMessage } from '../lib/apiError';

interface TransactionRow {
  _id: string;
  type: string;
  credits: number;
  grossCents: number;
  netCents: number;
  vatCents: number;
  vatRate: number;
  country: string | null;
  currency: string;
  status: string;
  invoiceNumber: string | null;
  createdAt: string;
}

const EU_COUNTRIES = [
  ['IT', 'Italia'], ['AT', 'Austria'], ['BE', 'Belgio'], ['BG', 'Bulgaria'], ['CY', 'Cipro'],
  ['HR', 'Croazia'], ['DK', 'Danimarca'], ['EE', 'Estonia'], ['FI', 'Finlandia'], ['FR', 'Francia'],
  ['DE', 'Germania'], ['GR', 'Grecia'], ['IE', 'Irlanda'], ['LV', 'Lettonia'], ['LT', 'Lituania'],
  ['LU', 'Lussemburgo'], ['MT', 'Malta'], ['NL', 'Paesi Bassi'], ['PL', 'Polonia'],
  ['PT', 'Portogallo'], ['CZ', 'Repubblica Ceca'], ['RO', 'Romania'], ['SK', 'Slovacchia'],
  ['SI', 'Slovenia'], ['ES', 'Spagna'], ['SE', 'Svezia'], ['HU', 'Ungheria']
];

const euro = (cents: number, currency = 'EUR') =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);

function Card({ title, icon: Icon, description, children, tone = 'normal' }: {
  title: string;
  icon: typeof Cookie;
  description: string;
  children: React.ReactNode;
  tone?: 'normal' | 'danger';
}) {
  return (
    <section className={`mb-6 rounded-xl border p-5 ${tone === 'danger' ? 'border-danger/30 bg-danger/5' : 'border-line bg-surface'}`}>
      <h2 className={`mb-1 flex items-center gap-2 font-display text-base font-semibold ${tone === 'danger' ? 'text-danger' : 'text-ink'}`}>
        <Icon className="h-4 w-4" aria-hidden="true" /> {title}
      </h2>
      <p className="mb-4 text-sm text-ink-muted">{description}</p>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  useDocumentTitle('Impostazioni');
  const navigate = useNavigate();
  const { user, setAuthModalOpen, notify, logout, patchUser, features } = useStore();

  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [functional, setFunctional] = useState<boolean>(getConsent()?.functional ?? false);
  const [savingPref, setSavingPref] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionRow[] | null>(null);

  useEffect(() => {
    if (!user) return;
    api.get('/payments/transactions')
      .then((res) => setTransactions(res.data.transactions))
      .catch(() => setTransactions([]));
  }, [user]);

  if (!user) {
    return (
      <EmptyState
        title="Accedi per gestire il tuo account"
        action={
          <button onClick={() => setAuthModalOpen(true, 'login')} className="btn-primary rounded-xl px-4 py-2 text-sm">
            Accedi
          </button>
        }
      />
    );
  }

  /** Aggiorna una preferenza sul server e riallinea lo stato locale. */
  const savePreference = async (key: string, payload: Record<string, unknown>, onOk: () => void) => {
    setSavingPref(key);
    try {
      const res = await api.patch('/users/me/preferences', payload);
      patchUser({
        nsfwEnabled: res.data.nsfwEnabled,
        billingCountry: res.data.billingCountry,
        cookieConsent: res.data.cookieConsent
      });
      onOk();
      notify('Preferenza aggiornata.', 'success');
    } catch (err: any) {
      notify(errorMessage(err, 'Aggiornamento non riuscito.'), 'error');
    } finally {
      setSavingPref(null);
    }
  };

  const updateConsent = (value: boolean) => {
    // La scelta vale subito, anche offline: è locale che governa il caricamento
    // dello script. La copia sul server serve a dimostrarla e a farla seguire
    // l'account fra dispositivi.
    setConsent(value);
    setFunctional(value);
    savePreference('consent', { cookieConsent: { functional: value, version: CONSENT_VERSION } }, () => {});
  };

  const exportData = async () => {
    setExporting(true);
    try {
      const res = await api.get('/users/me/export', { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `your-character-dati-${user.username}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      notify('Esportazione completata.', 'success');
    } catch (err: any) {
      notify(
        err.response?.status === 429
          ? 'Hai già esportato i dati di recente. Riprova più tardi.'
          : 'Esportazione non riuscita.',
        'error'
      );
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await api.delete('/users/me');
      notify('Account eliminato.', 'success');
      await logout();
      navigate('/');
    } catch {
      notify('Eliminazione non riuscita.', 'error');
      setDeleting(false);
    }
  };

  const openReceipt = async (transactionId: string) => {
    try {
      const res = await api.get(`/payments/receipt/${transactionId}`);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ricevuta-${res.data.invoiceNumber ?? transactionId}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      notify(errorMessage(err, 'Ricevuta non disponibile.'), 'error');
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-8">
      <h1 className="mb-8 font-display text-2xl font-bold text-ink">Impostazioni</h1>

      {/* --- Cookie (S2-6) ---------------------------------------------------- */}
      <Card
        title="Cookie e script di terze parti"
        icon={Cookie}
        description={
          features.payments
            ? "I cookie tecnici tengono aperta la sessione e non sono disattivabili: senza, non potresti restare connesso. L'unica scelta riguarda il caricamento anticipato dello script di pagamento di Stripe."
            : "Usiamo solo cookie tecnici, per tenere aperta la sessione. Non ci sono script di terze parti attivi, quindi non c'è nulla da autorizzare o rifiutare."
        }
      >
        {/* La scelta compare solo se esiste davvero qualcosa su cui scegliere.
            Due pulsanti che fanno la stessa cosa sarebbero teatro. */}
        {features.payments && (
        <div className="flex flex-wrap gap-2">
          {[
            { value: false, label: 'Solo tecnici' },
            { value: true, label: 'Consenti anche Stripe' }
          ].map((option) => (
            <button
              key={String(option.value)}
              onClick={() => updateConsent(option.value)}
              aria-pressed={functional === option.value}
              className={`rounded-xl border px-4 py-2 text-sm transition-colors ${
                functional === option.value
                  ? 'border-accent bg-accent-wash text-accent-glow'
                  : 'border-line bg-bg text-ink-muted hover:border-line-strong'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        )}
        {user.cookieConsent?.updatedAt && (
          <p className="mt-3 text-xs text-ink-dim">
            Scelta registrata il {new Date(user.cookieConsent.updatedAt).toLocaleString('it-IT')}
          </p>
        )}
        <p className="mt-2 text-xs text-ink-dim">
          Non usiamo cookie analitici né pubblicitari, quindi non troverai interruttori per categorie
          che non esistono.
        </p>
      </Card>

      {/* --- Contenuti per adulti (S2-3) -------------------------------------- */}
      <Card
        title="Contenuti per adulti"
        icon={EyeOff}
        description="I personaggi contrassegnati come per adulti restano fuori dalla galleria finché non li attivi. L'attivazione richiede di essere maggiorenne secondo la data di nascita del tuo account."
      >
        {/* L'interruttore qui sotto e' un vero switch, non una casella di
            sistema: prima era un quadratino grigio non stilizzato, e
            sull'impostazione piu' delicata della pagina sembrava un comando
            lasciato a meta'. `role="switch"` e' anche cio' che uno screen
            reader deve sentire — acceso o spento, non selezionato o no. */}
        {user.isAdult ? (
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-line bg-bg p-4">
            <span className="text-sm text-ink">Mostra i contenuti per adulti</span>
            <button
              type="button"
              role="switch"
              aria-checked={user.nsfwEnabled === true}
              aria-label="Mostra i contenuti per adulti"
              disabled={savingPref === 'nsfw'}
              onClick={() =>
                savePreference('nsfw', { nsfwEnabled: !(user.nsfwEnabled === true) }, () => {})
              }
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                user.nsfwEnabled === true ? 'bg-accent' : 'bg-surface-hover border border-line'
              }`}
            >
              {/* `left-0` non e' decorativo: senza, un elemento in posizione
                  assoluta senza coordinate cade nella sua posizione STATICA, e
                  dentro un <button> — che ha text-align:center per default —
                  quella posizione e' il centro. Il pallino risultava a meta'
                  strada e l'interruttore sembrava acceso mentre era spento,
                  proprio sul comando dei contenuti per adulti. */}
              <span
                aria-hidden="true"
                className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  user.nsfwEnabled === true ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}
              />
            </button>
          </label>
        ) : (
          <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <p className="text-sm text-ink-muted">
              Il tuo account non risulta maggiorenne, quindi questa impostazione non è disponibile.
            </p>
          </div>
        )}
      </Card>

      {/* --- Paese ai fini IVA (S2-12) ----------------------------------------
          Aliquota IVA e ricevute esistono solo dove si vende: senza pagamenti
          attivi sarebbero due schede che parlano di qualcosa che non accade. */}
      {features.payments && (
      <Card
        title="Paese di fatturazione"
        icon={Globe2}
        description="Determina l'aliquota IVA applicata ai tuoi acquisti: per i servizi digitali l'imposta è dovuta nel paese del cliente."
      >
        <label htmlFor="billing-country" className="sr-only">Paese di fatturazione</label>
        <select
          id="billing-country"
          value={user.billingCountry ?? ''}
          disabled={savingPref === 'country'}
          onChange={(e) => savePreference('country', { billingCountry: e.target.value }, () => {})}
          className="input-field"
        >
          <option value="" disabled>Seleziona un paese</option>
          {EU_COUNTRIES.map(([code, name]) => (
            <option key={code} value={code}>{name}</option>
          ))}
        </select>
      </Card>
      )}

      {/* --- Ricevute (S2-12) -------------------------------------------------- */}
      {features.payments && (
      <Card
        title="Pagamenti e ricevute"
        icon={Receipt}
        description="Ogni pagamento riuscito ha una ricevuta numerata con imponibile, aliquota e imposta."
      >
        {transactions === null && (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Caricamento…
          </p>
        )}

        {transactions?.length === 0 && (
          <p className="text-sm text-ink-dim">Non hai ancora effettuato pagamenti.</p>
        )}

        {transactions && transactions.length > 0 && (
          <ul className="divide-y divide-line">
            {transactions.map((t) => (
              <li key={t._id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">
                    {t.type === 'subscription' ? 'Abbonamento' : `${t.credits} crediti`}
                    <span className="ml-2 text-xs text-ink-dim">
                      {new Date(t.createdAt).toLocaleDateString('it-IT')}
                    </span>
                  </p>
                  <p className="text-xs text-ink-dim">
                    {euro(t.grossCents, t.currency)}
                    {t.vatRate > 0 && ` · IVA ${t.vatRate}% (${euro(t.vatCents, t.currency)}) · ${t.country}`}
                    {t.invoiceNumber && ` · ${t.invoiceNumber}`}
                  </p>
                </div>
                {t.status === 'completed' ? (
                  <button onClick={() => openReceipt(t._id)} className="btn-secondary rounded-lg px-3 py-1.5 text-xs">
                    Ricevuta
                  </button>
                ) : (
                  <span className="text-xs text-ink-dim">{t.status}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      )}

      {/* --- Dati personali ---------------------------------------------------- */}
      <Card
        title="I tuoi dati"
        icon={ShieldCheck}
        description="Scarica una copia completa di profilo, personaggi, conversazioni, transazioni, consensi e segnalazioni inviate."
      >
        <button onClick={exportData} disabled={exporting} className="btn-secondary flex items-center gap-2 rounded-xl px-4 py-2 text-sm">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
          Esporta i miei dati
        </button>
      </Card>

      {/* L'endpoint di eliminazione esisteva dal primo giorno e non aveva alcun
          pulsante nell'interfaccia (S3-8). */}
      <Card
        title="Elimina l'account"
        icon={Trash2}
        tone="danger"
        description="Vengono eliminati profilo, conversazioni, messaggi e personaggi privati. I personaggi pubblici restano in galleria, attribuiti all'account di sistema. Le transazioni sono conservate per l'obbligo fiscale decennale. L'operazione non è reversibile."
      >
        <button
          onClick={() => setDeleteOpen(true)}
          className="flex items-center gap-2 rounded-xl border border-danger/50 px-4 py-2 text-sm text-danger transition-colors hover:bg-danger/10"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Elimina account
        </button>
      </Card>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Eliminare definitivamente l'account?">
        <p className="mb-4 text-sm text-ink-muted">
          Per confermare, scrivi il tuo nome utente <strong className="text-ink">{user.username}</strong>.
        </p>
        <label htmlFor="confirm-delete" className="sr-only">Nome utente per conferma</label>
        <input
          id="confirm-delete"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={user.username}
          autoComplete="off"
          className="input-field"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setDeleteOpen(false)} className="btn-secondary rounded-xl px-4 py-2 text-sm">Annulla</button>
          <button
            onClick={deleteAccount}
            disabled={confirmText !== user.username || deleting}
            className="flex items-center gap-2 rounded-xl bg-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-danger/85 disabled:opacity-40"
          >
            {deleting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Elimina definitivamente
          </button>
        </div>
      </Modal>
    </div>
  );
}
