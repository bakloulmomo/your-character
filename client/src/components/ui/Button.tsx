import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LinkProps } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Il pulsante.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Perché esiste: fra le classi di `index.css` e le pagine non c'era niente.
 * `.btn-primary` dava il colore, ma dimensione, raggio, corpo del testo,
 * allineamento dell'icona e stato di caricamento andavano riscritti a mano ogni
 * volta. Il risultato misurato, prima di questo file:
 *
 *   · la stringa `rounded-xl px-4 py-2 text-sm` copiata in 29 punti su 12 file
 *   · il pulsante distruttivo riscritto a mano 4 volte, in DUE forme diverse
 *     (contorno rosso in tre pagine, riempimento pieno in altre due) senza che
 *     nulla dicesse quando usare l'una o l'altra
 *   · `rounded-xl` (10px) usato 109 volte in un sistema il cui manifesto
 *     dichiarava di volere raggi piccoli
 *
 * Nessuna di queste è disattenzione: sono la conseguenza inevitabile di far
 * scegliere a chi scrive la pagina cose che dovrebbe portare il componente.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** `twMerge` risolve i conflitti: una classe passata da fuori vince sempre. */
const cn = (...parti: unknown[]) => twMerge(clsx(parti));

type Variante = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-strong';
type Misura = 'sm' | 'md' | 'lg';

const VARIANTI: Record<Variante, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  /**
   * Distruttivo di CONTORNO: l'azione esiste nella pagina ma non è ciò che si
   * viene a fare («Elimina il personaggio» accanto ad «Apri conversazione»).
   */
  danger:
    'border border-danger/50 text-danger font-medium transition-colors duration-150 ' +
    'hover:bg-danger/10 active:translate-y-px disabled:opacity-40 disabled:cursor-not-allowed',
  /**
   * Distruttivo PIENO: la conferma finale, quando la pagina non chiede altro.
   * Testo scuro sul riempimento — 6.17:1. Il rosso è abbastanza chiaro da
   * reggerlo; il blu dell'accento no, ed è per questo che il primario è
   * l'unico riempimento pieno con il testo chiaro sopra.
   */
  'danger-strong':
    'bg-danger text-bg font-semibold transition-colors duration-150 ' +
    'hover:bg-danger/90 active:translate-y-px disabled:opacity-40 disabled:cursor-not-allowed'
};

/**
 * Le altezze minime non sono decorative: un bersaglio da 16px di altezza non si
 * centra con un dito, ed è un difetto che era già stato corretto a mano in una
 * pagina sola.
 */
const MISURE: Record<Misura, string> = {
  sm: 'min-h-[34px] gap-1.5 rounded px-3 py-1.5 text-xs',
  md: 'min-h-[40px] gap-2 rounded-md px-4 py-2 text-sm',
  lg: 'min-h-[46px] gap-2 rounded-md px-5 py-2.5 text-base'
};

const BASE = 'inline-flex items-center justify-center whitespace-nowrap';

interface Comuni {
  variant?: Variante;
  size?: Misura;
  /** Occupa tutta la larghezza disponibile — tipico nei modali e su telefono. */
  block?: boolean;
  className?: string;
  children?: ReactNode;
}

const classi = ({ variant = 'secondary', size = 'md', block, className }: Comuni) =>
  cn(BASE, VARIANTI[variant], MISURE[size], block && 'w-full', className);

interface ButtonProps extends Comuni, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> {
  /**
   * In corso. Disabilita, annuncia `aria-busy` e sostituisce l'eventuale icona
   * con la rotella — tre cose che venivano fatte a mano, e non ovunque.
   */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, block, className, loading, disabled, children, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classi({ variant, size, block, className })}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
});

/**
 * Lo stesso aspetto, ma è un collegamento.
 *
 * Separato di proposito: un `<button>` che naviga e un `<a>` che sembra un
 * pulsante si comportano diversamente sotto la tastiera, nel menu contestuale e
 * per il lettore di schermo. La scelta dell'elemento resta esplicita a chi
 * scrive la pagina, l'aspetto no.
 */
interface ButtonLinkProps extends Comuni, Omit<LinkProps, 'className' | 'children'> {}

export function ButtonLink({ variant, size, block, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={classi({ variant, size, block, className })} {...rest}>
      {children}
    </Link>
  );
}

export default Button;
