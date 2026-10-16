import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const cn = (...parti: unknown[]) => twMerge(clsx(parti));

/**
 * Il contenitore di pagina, e l'intestazione di pagina.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Prima ogni pagina inventava il proprio contenitore. Il conto era di SETTE
 * larghezze diverse (`76rem`, `7xl`, `5xl`, `4xl`, `3xl`, `md`, e una a caso)
 * e TRE ritmi verticali (`py-8`, `py-12`, `py-14`), senza che nulla dicesse
 * quale scegliere. Due pagine sorelle finivano larghe diversamente per il solo
 * motivo di essere state scritte in giorni diversi — ed è precisamente il
 * genere di incoerenza che si legge come «generato», perché nessun umano che
 * abbia visto le due pagine di fila le lascerebbe così.
 *
 * Qui le larghezze sono tre e hanno un NOME che dice a cosa servono, non una
 * misura. Chi scrive la pagina dichiara l'intenzione, non il numero.
 * ─────────────────────────────────────────────────────────────────────────────
 */
type Larghezza = 'prose' | 'default' | 'wide';

const LARGHEZZE: Record<Larghezza, string> = {
  /** Una colonna di testo da leggere: documenti, moduli, impostazioni. */
  prose: 'max-w-3xl',
  /** Il caso normale: elenchi, schede, profilo. */
  default: 'max-w-5xl',
  /** La galleria, dove il contenuto sono le immagini e servono più colonne. */
  wide: 'max-w-[76rem]'
};

export function PageContainer({
  width = 'default',
  className,
  children
}: {
  width?: Larghezza;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('mx-auto w-full px-5 py-10 md:px-8 md:py-14', LARGHEZZE[width], className)}>
      {children}
    </div>
  );
}

/**
 * L'intestazione di pagina.
 *
 * Sostituisce gli otto `<h1>` che ogni pagina componeva a mano con
 * `font-display text-2xl font-bold` — una misura che non apparteneva nemmeno
 * alla scala — contro l'unica pagina che usava quella del progetto. Il corpo
 * predefinito è `display-md`; `display-lg` è per le pagine che aprono, e
 * `display-xl` è l'insegna della galleria.
 *
 * `eyebrow` è l'occhiello sopra il titolo: dà il contesto senza spendere un
 * secondo livello di intestazione, che ai lettori di schermo costerebbe una
 * gerarchia falsa.
 */
export function PageHeader({
  media,
  eyebrow,
  title,
  description,
  size = 'md',
  actions,
  className
}: {
  /** Ritratto o avatar a fianco del titolo: una persona, o un personaggio. */
  media?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
  actions?: ReactNode;
  className?: string;
}) {
  const corpo = { md: 'text-display-md', lg: 'text-display-lg', xl: 'text-display-xl' }[size];

  return (
    <header className={cn('mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="flex min-w-0 items-start gap-5">
        {media && <div className="shrink-0">{media}</div>}
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-2.5">{eyebrow}</p>}
          {/**
            * `break-words` non è prudenza: a 390px un nome utente di
            * diciotto caratteri composto a 36px è più largo dello schermo, e
            * senza un punto in cui spezzare la pagina scorreva in orizzontale
            * di 52px. Vale per ogni titolo che venga da un dato dell'utente —
            * cioè per quasi tutti — e per gli indirizzi email, che non hanno
            * spazi in cui andare a capo.
            */}
          <h1 className={cn('title-display break-words', corpo)}>{title}</h1>
          {description && (
            <p className="mt-3 max-w-prose break-words text-base text-ink-muted">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Il blocco.
 *
 * Sostituisce le 16 copie di `rounded-xl border border-line bg-surface`, e il
 * `<Card>` privato che viveva dentro `SettingsPage` senza che nessun'altra
 * pagina potesse usarlo.
 *
 * `bare` è la variante che il sistema preferisce: niente riquadro, solo il
 * contenuto e lo spazio intorno. Un rettangolo intorno a un contenuto dice
 * «questo è un oggetto»; quasi sempre la verità è che è solo del testo.
 */
export function Block({
  bare,
  className,
  children,
  ...rest
}: { bare?: boolean; className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        bare ? 'py-1' : 'rounded-lg border border-line bg-surface p-5',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * Un numero con la sua etichetta, senza la scatola intorno.
 *
 * `ProfilePage` mostrava crediti, piano e uso di oggi dentro tre tessere
 * bordate — il pattern «cruscotto» che qualunque generatore produce per
 * primo. Tre riquadri grigi in fila non aggiungono informazione al numero che
 * contengono: aggiungono solo bordi. Qui la gerarchia la fanno il corpo del
 * testo e un filo di separazione.
 */
export function Stat({
  label,
  value,
  hint
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className="title-display tabular mt-1.5 text-display-sm">{value}</p>
      {hint && <div className="mt-1.5 text-xs text-ink-dim">{hint}</div>}
    </div>
  );
}

/**
 * Metadato o stato: peso e filo, mai una tinta piena.
 *
 * Le pastiglie `bg-accent-wash text-accent-glow` comparivano in quattro
 * pagine — le stesse che `CharacterCard` dichiarava per iscritto di aver
 * eliminato. Colorare un'etichetta le dà l'importanza di un'azione, e
 * un'etichetta non è un'azione: non si può premere.
 *
 * `tone` esiste solo dove il significato non sta già nella parola: «Respinto»
 * si spiega da sé, un contenuto per adulti no.
 */
export function Badge({
  tone = 'neutral',
  children,
  className
}: {
  tone?: 'neutral' | 'danger' | 'success' | 'warning';
  children: ReactNode;
  className?: string;
}) {
  const TONI = {
    neutral: 'border-line-strong text-ink-muted',
    danger: 'border-danger/40 text-danger',
    success: 'border-success/40 text-success',
    warning: 'border-warning/40 text-warning'
  } as const;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-micro font-medium',
        TONI[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
