import { ArrowLeft, ShieldCheck, Trash2, Download, Lock, Globe2, Clock, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Informativa sulla privacy (FASE D — S2-5).
 *
 * La versione precedente non era veritiera: non nominava Google Gemini né
 * Stability AI fra i responsabili del trattamento — cioè taceva proprio i
 * destinatari a cui viene inviato il contenuto delle conversazioni — non
 * dichiarava il trasferimento extra-UE, non indicava periodi di conservazione
 * né basi giuridiche, e attribuiva a Clerk la gestione dell'identità, che non
 * è il meccanismo realmente in uso (email e password con sessione JWT).
 *
 * Qui ogni riga corrisponde a qualcosa che il codice fa davvero. Dove un dato
 * dipende dalla configurazione dell'operatore (ragione sociale, titolare) il
 * testo lo dichiara come da completare invece di inventarlo.
 */

const PROCESSORS = [
  {
    name: 'Google Ireland Ltd. — Gemini API',
    purpose: 'Generazione delle risposte dei personaggi.',
    data: 'Testo dei messaggi della conversazione e descrizione del personaggio.',
    location: 'UE con possibile trattamento negli Stati Uniti',
    safeguard: 'Clausole contrattuali standard e EU-US Data Privacy Framework'
  },
  {
    name: 'Stability AI Ltd.',
    purpose: 'Generazione delle immagini richieste in chat.',
    data: 'Testo del prompt inviato per la generazione.',
    location: 'Regno Unito / Stati Uniti',
    safeguard: 'Clausole contrattuali standard e decisione di adeguatezza UK'
  },
  {
    name: 'Stripe Payments Europe Ltd.',
    purpose: 'Incasso dei pagamenti e gestione degli abbonamenti.',
    data: 'Email, importo, paese; i dati della carta sono raccolti direttamente da Stripe e non transitano dai nostri sistemi.',
    location: 'Irlanda, con trasferimenti infragruppo verso gli Stati Uniti',
    safeguard: 'Clausole contrattuali standard'
  },
  {
    name: 'MongoDB Inc. — Atlas',
    purpose: 'Archiviazione del database dell’applicazione.',
    data: 'Tutti i dati dell’account e delle conversazioni.',
    location: 'Regione di hosting scelta dall’operatore',
    safeguard: 'Clausole contrattuali standard'
  },
  {
    name: 'Cloudinary Ltd.',
    purpose: 'Archiviazione e distribuzione delle immagini generate.',
    data: 'File immagine prodotti su richiesta.',
    location: 'Israele / Stati Uniti',
    safeguard: 'Decisione di adeguatezza per Israele, clausole contrattuali standard'
  },
  {
    name: 'Resend, Inc.',
    purpose: 'Invio delle email di servizio (recupero password).',
    data: 'Indirizzo email e contenuto del messaggio di servizio.',
    location: 'Stati Uniti',
    safeguard: 'Clausole contrattuali standard'
  }
];

const RETENTION = [
  ['Account e profilo', 'Fino alla cancellazione dell’account, poi eliminazione immediata.'],
  ['Conversazioni e messaggi', 'Fino alla cancellazione della chat o dell’account.'],
  ['Immagini generate', 'Come le conversazioni a cui appartengono.'],
  ['Transazioni e ricevute', '10 anni dalla data del pagamento — obbligo civilistico e fiscale (art. 2220 c.c.); sopravvivono alla cancellazione dell’account in forma minimizzata.'],
  ['Segnalazioni e provvedimenti di moderazione', '24 mesi dalla chiusura del caso.'],
  ['Token di recupero password', '1 ora, poi invalidati; in database è conservata solo la loro impronta.'],
  ['Log tecnici e di sicurezza', '90 giorni.']
];

const LEGAL_BASES = [
  ['Creazione dell’account, conversazioni, pagamenti', 'Esecuzione del contratto (art. 6.1.b GDPR)'],
  ['Moderazione dei contenuti e prevenzione degli abusi', 'Legittimo interesse a un servizio sicuro (art. 6.1.f) e obblighi di legge (art. 6.1.c)'],
  ['Conservazione dei documenti fiscali', 'Obbligo legale (art. 6.1.c GDPR)'],
  ['Caricamento anticipato dello script di pagamento', 'Consenso (art. 6.1.a GDPR), revocabile dalle impostazioni']
];

function Section({ title, icon: Icon, children }: { title: string; icon?: typeof Lock; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-bold text-ink">
        {Icon && <Icon className="h-5 w-5 text-sapphire-glow" aria-hidden="true" />} {title}
      </h2>
      <div className="space-y-4 leading-relaxed text-ink-muted">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-bg font-sans text-ink">
      <header className="glass-panel sticky top-0 z-50 border-b border-line px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center gap-4">
          <Link
            to="/"
            id="privacy-back-btn"
            aria-label="Torna alla home"
            className="rounded-xl p-2 text-ink-muted transition-all hover:bg-surface-hover hover:text-ink"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="font-display text-lg font-bold text-ink">Informativa sulla privacy</h1>
            <p className="font-mono text-xs text-ink-dim">Ultimo aggiornamento: 28 agosto 2026</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="glass-card space-y-8 rounded-2xl border border-line p-8">
          <section>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-600/10 px-3 py-1.5 text-xs font-medium text-success">
              <ShieldCheck className="h-4 w-4" /> Regolamento (UE) 2016/679
            </div>
            <p className="leading-relaxed text-ink-muted">
              Questa informativa descrive che cosa <span className="font-semibold text-ink">your-character</span> fa
              davvero con i tuoi dati. Il punto più importante è in cima e non sepolto in fondo:{' '}
              <strong className="text-ink">
                il testo delle tue conversazioni viene inviato a Google (Gemini) per generare le risposte
              </strong>{' '}
              e i prompt delle immagini vengono inviati a Stability AI. Senza questo invio il servizio non
              può funzionare.
            </p>
          </section>

          <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
            <p className="text-sm text-ink-muted">
              <strong className="text-ink">Titolare del trattamento.</strong> Ragione sociale, sede e
              partita IVA dell’operatore del servizio vanno indicati qui prima della pubblicazione al
              pubblico. Finché questo riquadro è presente, il documento è tecnicamente completo ma
              amministrativamente da finalizzare: non inventiamo un’intestazione che non abbiamo.
            </p>
          </div>

          <hr className="border-line" />

          <Section title="1. Dati raccolti e finalità" icon={Lock}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {[
                ['Dati di account', 'Email, nome utente, password (conservata solo come impronta bcrypt, mai in chiaro) e data di nascita, necessaria per la verifica della maggiore età.'],
                ['Conversazioni', 'Messaggi scambiati con i personaggi, sintesi delle conversazioni lunghe e immagini generate.'],
                ['Personaggi creati', 'Nome, descrizione, personalità, storia e istruzioni del personaggio.'],
                ['Pagamenti', 'Importo, imponibile, IVA, paese di consumo, numero di ricevuta e identificativo Stripe. I dati della carta non ci arrivano mai.'],
                ['Dati tecnici', 'Indirizzo IP e log di accesso, usati per i limiti di frequenza e la prevenzione degli abusi.'],
                ['Moderazione', 'Frammenti di contenuto bloccato, conservati come prova nelle segnalazioni per consentirne la revisione.']
              ].map(([title, body]) => (
                <div key={title} className="rounded-xl border border-line bg-surface p-4">
                  <h3 className="mb-1 text-sm font-semibold text-ink">{title}</h3>
                  <p className="text-xs text-ink-muted">{body}</p>
                </div>
              ))}
            </div>
            <p className="text-sm">
              L’autenticazione avviene con email e password e una sessione firmata (JWT) conservata in un
              cookie <code className="font-mono text-blue-300">yc_token</code> di tipo HttpOnly.
            </p>
          </Section>

          <Section title="2. A chi vengono comunicati i dati" icon={Globe2}>
            <p>
              Questi sono i responsabili del trattamento con cui i dati sono condivisi, e per quale
              motivo. Non vendiamo dati a nessuno e non li usiamo per pubblicità.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="border-b border-line text-ink">
                  <tr>
                    <th className="py-2 pr-4 font-semibold">Destinatario</th>
                    <th className="py-2 pr-4 font-semibold">Finalità e dati</th>
                    <th className="py-2 pr-4 font-semibold">Luogo</th>
                    <th className="py-2 font-semibold">Garanzia per il trasferimento</th>
                  </tr>
                </thead>
                <tbody>
                  {PROCESSORS.map((p) => (
                    <tr key={p.name} className="border-b border-line/50 align-top">
                      <td className="py-3 pr-4 font-medium text-ink">{p.name}</td>
                      <td className="py-3 pr-4">{p.purpose}<br /><span className="text-ink-dim">{p.data}</span></td>
                      <td className="py-3 pr-4">{p.location}</td>
                      <td className="py-3">{p.safeguard}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm">
              Alcuni di questi trattamenti comportano un <strong className="text-ink">trasferimento
              fuori dallo Spazio economico europeo</strong>. Avviene sulla base delle garanzie indicate
              in tabella; puoi chiederne copia scrivendo all’indirizzo in fondo alla pagina.
            </p>
          </Section>

          <Section title="3. Basi giuridiche">
            <ul className="space-y-2 text-sm">
              {LEGAL_BASES.map(([what, basis]) => (
                <li key={what} className="flex flex-col gap-0.5 rounded-lg border border-line bg-surface p-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <span className="text-ink">{what}</span>
                  <span className="shrink-0 font-mono text-xs text-ink-dim">{basis}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="4. Per quanto tempo" icon={Clock}>
            <ul className="space-y-2 text-sm">
              {RETENTION.map(([what, howLong]) => (
                <li key={what} className="rounded-lg border border-line bg-surface p-3">
                  <span className="font-medium text-ink">{what}</span>
                  <p className="mt-0.5 text-xs text-ink-muted">{howLong}</p>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="5. I tuoi diritti">
            <p>
              Puoi esercitare i diritti previsti dagli articoli 15-22 del GDPR direttamente dalle{' '}
              <Link to="/settings" className="text-sapphire-glow underline">impostazioni del tuo account</Link>,
              senza scrivere a nessuno e senza attese.
            </p>
            <div className="space-y-4">
              <div className="flex items-start gap-4 rounded-xl border border-blue-800/40 bg-blue-950/20 p-4">
                <Download className="mt-1 h-6 w-6 shrink-0 text-sapphire-glow" />
                <div>
                  <h3 className="text-sm font-semibold text-ink">Accesso e portabilità (artt. 15 e 20)</h3>
                  <p className="mt-1 text-xs text-ink-muted">
                    «Esporta i miei dati» scarica in formato JSON profilo, personaggi, conversazioni,
                    messaggi, transazioni, consensi e segnalazioni inviate.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4 rounded-xl border border-red-800/40 bg-red-950/20 p-4">
                <Trash2 className="mt-1 h-6 w-6 shrink-0 text-danger" />
                <div>
                  <h3 className="text-sm font-semibold text-ink">Cancellazione (art. 17)</h3>
                  <p className="mt-1 text-xs text-ink-muted">
                    «Elimina account» cancella profilo, conversazioni, messaggi e personaggi privati.
                    I personaggi che avevi reso pubblici restano in galleria attribuiti a un account di
                    sistema; le transazioni sono conservate per l’obbligo fiscale decennale. È
                    irreversibile.
                  </p>
                </div>
              </div>
            </div>
            <p className="text-sm">
              Hai inoltre diritto di rettifica (art. 16), limitazione (art. 18), opposizione (art. 21) e
              di proporre reclamo al Garante per la protezione dei dati personali.
            </p>
          </Section>

          <Section title="6. Cookie">
            <p className="text-sm">
              Usiamo un solo cookie tecnico, <code className="font-mono text-blue-300">yc_token</code>,
              per mantenere la sessione: è necessario al funzionamento e non richiede consenso. Non
              utilizziamo cookie analitici né pubblicitari. L’unica scelta facoltativa riguarda il
              caricamento anticipato dello script di pagamento di Stripe, ed è revocabile in qualsiasi
              momento dalle <Link to="/settings" className="text-sapphire-glow underline">impostazioni</Link>.
            </p>
          </Section>

          <Section title="7. Sicurezza">
            <p className="text-sm">
              Le password sono conservate come impronte bcrypt con dodici cicli. Le sessioni sono
              revocabili: uscendo dall’account i token già emessi smettono di funzionare. Il traffico
              viaggia su HTTPS, gli endpoint costosi hanno limiti di frequenza per utente e i contenuti
              passano da una moderazione automatica prima e dopo la generazione.
            </p>
            <p className="text-sm">
              Nessun sistema è inviolabile: se dovesse verificarsi una violazione che comporta un rischio
              per i tuoi diritti, ti informeremo secondo l’art. 34 del GDPR.
            </p>
          </Section>

          <Section title="8. Contatti">
            <p className="text-sm">
              Per esercitare i tuoi diritti o chiedere chiarimenti:{' '}
              <a href="mailto:privacy@your-character.app" className="text-sapphire-glow hover:underline">
                privacy@your-character.app
              </a>. Rispondiamo entro un mese, come previsto dall’art. 12.
            </p>
          </Section>
        </div>
      </main>
    </div>
  );
}
