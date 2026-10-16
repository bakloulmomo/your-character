import { useDocumentTitle } from '../lib/useDocumentTitle';
import { LegalLayout } from '../components/ui/Legal';

export default function TermsPage() {
  useDocumentTitle('Termini di servizio');
  return (
    <LegalLayout title="Termini e Condizioni d'Uso" updated="Versione 1.0 · in vigore dal 28 agosto 2026">
      {/* Intro */}
      <section>
        <p className="text-ink-muted leading-relaxed">
          Benvenuto su <span className="text-ink font-semibold">your-character</span> ("Piattaforma"). Accedendo o utilizzando i nostri servizi, accetti di essere vincolato dai seguenti Termini e Condizioni. Leggili attentamente prima di procedere.
        </p>
      </section>


      {/* Section 1 */}
      <section className="rule pt-8">
        <h2 className="title-display mb-4 text-display-sm">1. Accettazione dei Termini</h2>
        <p className="text-ink-muted leading-relaxed">
          Utilizzando la Piattaforma, dichiari di avere almeno <strong className="text-ink">18 anni</strong> (o la maggiore età nel tuo paese di residenza) e di avere la capacità legale di accettare questi Termini. Se accedi per conto di un'organizzazione, garantisci di avere l'autorizzazione per farlo.
        </p>
      </section>

      {/* Section 2 */}
      <section className="rule pt-8">
        <h2 className="title-display mb-4 text-display-sm">2. Descrizione del Servizio</h2>
        <p className="text-ink-muted leading-relaxed mb-3">
          your-character fornisce una piattaforma di conversazione con personaggi AI. Il servizio include:
        </p>
        <ul className="space-y-2 text-ink-muted">
          {[
            'Accesso a personaggi AI pubblici pre-esistenti',
            'Creazione di personaggi AI personalizzati',
            'Generazione di immagini tramite intelligenza artificiale',
            'Sistema di crediti per accedere alle funzionalità premium',
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-accent mt-2 shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Section 3 */}
      <section className="rule pt-8">
        <h2 className="title-display mb-4 text-display-sm">3. Account e Sicurezza</h2>
        <p className="text-ink-muted leading-relaxed">
          Sei responsabile della sicurezza delle tue credenziali di accesso. Devi notificarci immediatamente in caso di accesso non autorizzato al tuo account. Non è consentita la condivisione dell'account con altri utenti. Ci riserviamo il diritto di sospendere o terminare account che violino questi Termini.
        </p>
      </section>

      {/* Section 4 */}
      <section className="rule pt-8">
        <h2 className="title-display mb-4 text-display-sm">4. Condotta Vietata</h2>
        <p className="text-ink-muted leading-relaxed mb-3">È severamente vietato:</p>
        <ul className="space-y-2 text-ink-muted">
          {[
            'Creare o condividere contenuti che coinvolgano minori in situazioni sessuali o violente',
            'Utilizzare la piattaforma per molestie, incitamento all\'odio o discriminazione',
            'Tentare di aggirare le misure di sicurezza o moderazione della piattaforma',
            'Impersonare altri utenti, personaggi reali o il team di your-character',
            'Utilizzare bot o sistemi automatizzati per accedere alla piattaforma senza autorizzazione',
            'Violare diritti di proprietà intellettuale di terze parti',
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-danger mt-2 shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Moderazione — sezione aggiunta nella FASE D: le regole di condotta
          esistevano già, ma non era scritto da nessuna parte che cosa
          succede quando vengono violate, né che i personaggi pubblici
          passano da una revisione. */}
      <section className="rule pt-8">
        <h2 className="title-display mb-4 text-display-sm">5. Moderazione e revisione dei contenuti</h2>
        <ul className="space-y-2 text-ink-muted">
          {[
            'I messaggi inviati e le risposte generate passano da un controllo automatico: un contenuto che viola le regole viene bloccato prima di essere mostrato, e in quel caso non ti viene addebitato alcun credito.',
            'I personaggi che rendi PUBBLICI non compaiono in galleria immediatamente: entrano in una coda di revisione. Finché sono in attesa restano visibili e utilizzabili solo da te. Ogni modifica successiva li riporta in revisione.',
            'I personaggi privati non sono soggetti a revisione preventiva e sono utilizzabili subito.',
            'I contenuti destinati a un pubblico adulto sono visibili solo a utenti maggiorenni che li hanno attivati esplicitamente nelle impostazioni.',
            'Le violazioni ripetute possono comportare il rifiuto del contenuto, la sospensione temporanea o la chiusura dell\'account. Un rifiuto viene sempre motivato.',
            'Puoi segnalare qualsiasi personaggio o messaggio; le segnalazioni sono esaminate da persone e non da un sistema automatico.'
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-accent mt-2 shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Section 6 */}
      <section className="rule pt-8">
        <h2 className="title-display mb-4 text-display-sm">6. Crediti e Pagamenti</h2>
        <p className="text-ink-muted leading-relaxed mb-3">
          I prezzi sono espressi in Euro e sono <strong className="text-ink">IVA inclusa</strong>:
          l'aliquota applicata è quella del tuo paese di residenza, come previsto dal regime OSS per
          i servizi digitali. Per ogni pagamento riuscito viene emessa una ricevuta numerata,
          consultabile e scaricabile dalle impostazioni del tuo account. I pagamenti sono gestiti da
          Stripe: i dati della tua carta non transitano dai nostri sistemi.
        </p>
        {/* Il testo precedente diceva che i crediti «non sono rimborsabili salvo
            diversa disposizione di legge»: nell'Unione la disposizione di legge
            esiste sempre per i consumatori, quindi quella formulazione dava per
            eccezione ciò che è la regola. */}
        <p className="text-ink-muted leading-relaxed mb-3">
          <strong className="text-ink">Diritto di recesso.</strong> In quanto consumatore hai
          quattordici giorni per recedere da un acquisto di contenuto digitale. Richiedendo la
          fornitura immediata dei crediti accetti che l'esecuzione cominci subito e riconosci di
          perdere il diritto di recesso per la parte già utilizzata; i crediti non ancora consumati
          restano rimborsabili entro i quattordici giorni. Per esercitare il recesso scrivi a{' '}
          <a href="mailto:supporto@your-character.app" className="text-accent-glow hover:underline">
            supporto@your-character.app
          </a>.
        </p>
        <p className="text-ink-muted leading-relaxed">
          Gli abbonamenti si rinnovano automaticamente alla scadenza. Puoi disdire in qualsiasi
          momento: l'accesso resta attivo fino alla fine del periodo già pagato e non vengono
          addebitati ulteriori rinnovi. Ci riserviamo il diritto di modificare i prezzi con un
          preavviso di 30 giorni.
        </p>
      </section>

      {/* Section 6 */}
      <section className="rule pt-8">
        <h2 className="title-display mb-4 text-display-sm">7. Proprietà Intellettuale</h2>
        <p className="text-ink-muted leading-relaxed">
          I contenuti generati dall'AI tramite la piattaforma sono concessi in licenza all'utente per uso personale e non commerciale. your-character mantiene tutti i diritti sulla piattaforma, il codice sorgente, i design e i modelli AI sottostanti. I personaggi creati dagli utenti rimangono di proprietà degli stessi creatori.
        </p>
      </section>

      {/* Section 7 */}
      <section className="rule pt-8">
        <h2 className="title-display mb-4 text-display-sm">8. Limitazione di Responsabilità</h2>
        <p className="text-ink-muted leading-relaxed">
          La piattaforma è fornita "così com'è". Non garantiamo la continuità del servizio o l'accuratezza dei contenuti generati dall'AI. La nostra responsabilità massima è limitata all'importo pagato negli ultimi 12 mesi. Non siamo responsabili per danni indiretti, incidentali o consequenziali.
        </p>
      </section>

      {/* Section 8 */}
      <section className="rule pt-8">
        <h2 className="title-display mb-4 text-display-sm">9. Diritto Applicabile</h2>
        <p className="text-ink-muted leading-relaxed">
          Questi Termini sono regolati dalla legge italiana e dalle normative dell'Unione Europea applicabili. Eventuali controversie saranno risolte dal tribunale competente nella giurisdizione del domicilio dell'utente (consumatore), in conformità con il Codice del Consumo italiano.
        </p>
      </section>

      {/* Section 9 */}
      <section className="rule pt-8">
        <h2 className="title-display mb-4 text-display-sm">10. Contatti</h2>
        <p className="text-ink-muted leading-relaxed">
          Per domande su questi Termini, contattaci all'indirizzo:{' '}
          <a href="mailto:legal@your-character.app" className="text-accent-glow hover:underline">
            legal@your-character.app
          </a>
        </p>
      </section>
    </LegalLayout>
  );
}
