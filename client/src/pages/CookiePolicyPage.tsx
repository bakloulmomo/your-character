import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import MarketingLayout from '../components/MarketingLayout';
import { Button } from '../components/ui/Button';
import { CONSENT_VERSION, getConsent, setConsent, type ConsentState } from '../lib/consent';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/**
 * Cookie policy.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Elenca SOLO ciò che il codice deposita davvero. È l'opposto di come vengono
 * scritte quasi sempre: un modello generico che dichiara analitica,
 * pubblicità, «cookie di profilazione di terze parti» e una tabella di venti
 * righe, per un sito che ne usa due. Dichiarare più di quanto si fa non è
 * prudenza — è una dichiarazione falsa, e in caso di controllo è la prima cosa
 * che si verifica aprendo il pannello del browser.
 *
 * Qui ci sono due voci, e sono due.
 *
 * La pagina permette anche di CAMBIARE la scelta. Una cookie policy che
 * spiega il consenso senza offrire un modo di revocarlo è incompleta: l'art. 7
 * comma 3 del GDPR chiede che revocare sia facile quanto acconsentire.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function CookiePolicyPage() {
  useDocumentTitle('Cookie');
  const [consenso, setConsensoLocale] = useState<ConsentState | null>(null);

  useEffect(() => setConsensoLocale(getConsent()), []);

  const cambia = (funzionale: boolean) => {
    setConsent(funzionale);
    setConsensoLocale(getConsent());
  };

  return (
    <MarketingLayout>
      <div className="mx-auto w-full max-w-3xl px-5 py-16 md:px-8 md:py-24">
        <p className="eyebrow mb-5">Cookie e archiviazione locale</p>
        <h1 className="title-display text-display-lg">Due voci, non venti</h1>
        <p className="mt-7 text-read text-ink-muted">
          Questo sito non usa cookie analitici né pubblicitari. Non c’è profilazione, non ci sono
          inserzionisti, e non esistono terze parti che ti seguono da una pagina all’altra. Quello
          che segue è l’elenco completo — non un estratto.
        </p>

        <section className="rule mt-16 pt-8">
          <h2 className="title-display text-display-sm">Cookie tecnico di sessione</h2>
          <dl className="mt-5 space-y-3 text-base text-ink-muted">
            <div className="flex flex-wrap gap-x-3">
              <dt className="w-32 shrink-0 text-ink-dim">Nome</dt>
              <dd className="font-mono text-sm">yc_token</dd>
            </div>
            <div className="flex flex-wrap gap-x-3">
              <dt className="w-32 shrink-0 text-ink-dim">A cosa serve</dt>
              <dd className="flex-1">Tenere aperta la sessione dopo l’accesso.</dd>
            </div>
            <div className="flex flex-wrap gap-x-3">
              <dt className="w-32 shrink-0 text-ink-dim">Durata</dt>
              <dd className="flex-1">Due giorni, rinnovati mentre usi il servizio.</dd>
            </div>
            <div className="flex flex-wrap gap-x-3">
              <dt className="w-32 shrink-0 text-ink-dim">Chi lo legge</dt>
              <dd className="flex-1">
                Solo il nostro server. È <span className="font-mono text-sm">HttpOnly</span>, quindi
                nemmeno il codice di questa pagina può vederlo, e{' '}
                <span className="font-mono text-sm">SameSite=Lax</span>, quindi non viaggia verso
                altri siti.
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-3">
              <dt className="w-32 shrink-0 text-ink-dim">Consenso</dt>
              <dd className="flex-1">
                Non richiesto: senza, non potresti restare connesso. È l’eccezione prevista
                dall’art. 122 del Codice privacy per i cookie strettamente necessari.
              </dd>
            </div>
          </dl>
        </section>

        <section className="rule mt-12 pt-8">
          <h2 className="title-display text-display-sm">Caricamento anticipato di Stripe</h2>
          <p className="mt-5 text-base leading-relaxed text-ink-muted">
            L’unica scelta che ti viene chiesta. Se acconsenti, lo script di pagamento di Stripe
            viene caricato all’apertura del sito e il modulo di pagamento si apre più in fretta; se
            rifiuti, viene caricato <em>solo</em> quando apri il modulo — perché a quel punto serve
            a eseguire una richiesta che hai appena fatto, e non è più una questione di consenso.
          </p>
          <p className="mt-4 text-base leading-relaxed text-ink-muted">
            Stripe può depositare cookie propri per la prevenzione delle frodi. La sua informativa è
            su{' '}
            <a
              href="https://stripe.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-glow underline underline-offset-2"
            >
              stripe.com/privacy
            </a>
            .
          </p>

          <div className="mt-8 rounded-lg border border-line bg-surface p-5">
            <p className="text-sm text-ink">
              La tua scelta attuale:{' '}
              <strong className="text-ink">
                {consenso === null
                  ? 'non ancora espressa'
                  : consenso.functional
                    ? 'caricamento anticipato consentito'
                    : 'solo cookie tecnici'}
              </strong>
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => cambia(false)} disabled={consenso?.functional === false}>
                Solo tecnici
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => cambia(true)}
                disabled={consenso?.functional === true}
              >
                Consenti anche Stripe
              </Button>
            </div>
            <p className="mt-3 text-xs text-ink-dim">
              Revocare è facile quanto acconsentire (art. 7 comma 3 GDPR). Versione del consenso in
              vigore: <span className="tabular">{CONSENT_VERSION}</span>.
            </p>
          </div>
        </section>

        <section className="rule mt-12 pt-8">
          <h2 className="title-display text-display-sm">Archiviazione locale</h2>
          <p className="mt-5 text-base leading-relaxed text-ink-muted">
            La tua scelta sui cookie è salvata nel browser (
            <span className="font-mono text-sm">localStorage</span>), perché deve valere anche
            offline e prima che il server sappia chi sei. Se hai un account, viene salvata anche sul
            tuo profilo, così ti segue fra dispositivi. Non contiene altro.
          </p>
        </section>

        <p className="mt-16 text-sm text-ink-dim">
          Il trattamento completo dei dati è descritto{' '}
          <Link to="/privacy" className="text-accent-glow underline underline-offset-2">
            nell’informativa sulla privacy
          </Link>
          .
        </p>
      </div>
    </MarketingLayout>
  );
}
