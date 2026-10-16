import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Il guscio dei documenti legali.
 *
 * Termini e privacy stanno FUORI da `AppShell` — sono documenti a sé, non
 * schermate dell'applicazione — e per questo si erano portati dietro ognuno il
 * proprio guscio, scritto a mano e in modo diverso. `TermsPage` era la pagina
 * più debole del prodotto: l'ordine delle classi invertito rispetto a tutto il
 * resto (`text-xl font-bold text-ink mb-3`, `max-w-4xl mx-auto`), nessun
 * carattere display sui titoli di sezione, dieci `<h2>` fuori scala, una
 * pastiglia colorata in cima e degli `<hr>` grezzi in mezzo. Sembrava scritta
 * da un altro autore, e in un certo senso lo era.
 *
 * Non è un dettaglio di rifinitura: termini e privacy sono le due pagine che un
 * investitore o un cliente aprono per capire se dietro al prodotto c'è
 * qualcuno che tiene le cose in ordine. Sono il colophon, e un colophon
 * trascurato dice di tutto il resto.
 */
export function LegalLayout({
  title,
  updated,
  children
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="glass-panel sticky top-0 z-50 border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-5 py-3.5 md:px-8">
          {/* `aria-label` e `aria-hidden`: senza, questo comando è un «link»
              senza nome — l'icona non è testo. */}
          <Link
            to="/"
            aria-label="Torna alla home"
            className="-ml-2 rounded-md p-2 text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
          <p className="eyebrow">{title}</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 py-14 md:px-8">
        <h1 className="title-display text-display-lg">{title}</h1>
        <p className="mt-4 text-sm text-ink-dim">{updated}</p>
        {/* Nessun riquadro attorno al documento: un testo lungo dentro una
            scatola diventa un pannello da consultare invece di una pagina da
            leggere. Lo spazio basta a dire dove comincia. */}
        <div className="mt-14 space-y-12">{children}</div>
      </main>
    </div>
  );
}

/**
 * Una sezione del documento: filo di separazione, titolo, corpo.
 *
 * Il filo sta SOPRA il titolo e non fra le sezioni come faceva l'`<hr>`: una
 * riga che introduce dice «qui comincia qualcosa», una riga che separa dice
 * solo «qui finisce». Quasi sempre la prima è più utile a chi cerca un punto
 * preciso in un documento lungo.
 */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rule pt-8">
      <h2 className="title-display mb-4 text-display-sm">{title}</h2>
      <div className="space-y-3 text-base leading-relaxed text-ink-muted">{children}</div>
    </section>
  );
}
