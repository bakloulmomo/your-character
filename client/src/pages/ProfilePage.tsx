import { Plus, Sparkles, Coins, Settings } from 'lucide-react';
import { useMyCharacters } from '../hooks/useCharacters';
import { useStore } from '../store/useStore';
import CharacterCard from '../components/CharacterCard';
import Avatar from '../components/ui/Avatar';
import { Button, ButtonLink } from '../components/ui/Button';
import { PageContainer, PageHeader, Stat } from '../components/ui/Page';
import { CardSkeleton, EmptyState, ErrorState } from '../components/ui/States';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/**
 * Il profilo.
 *
 * Era la pagina più generica del prodotto: tre tessere bordate in fila —
 * crediti, piano, uso di oggi — ognuna `rounded-xl border border-line
 * bg-surface p-4` con dentro un numero in `title-display text-display-md`,
 * una misura che non apparteneva nemmeno alla scala. È il pattern «cruscotto»
 * che qualunque generatore produce per primo, e non aggiunge nulla ai tre
 * numeri che contiene: aggiunge solo dodici bordi.
 *
 * Qui i numeri stanno su una riga, separati da un filo, e la gerarchia la fanno
 * il corpo del testo e lo spazio. Le stesse tre informazioni, senza le scatole.
 */
export default function ProfilePage() {
  useDocumentTitle('Il tuo profilo');
  const { user, setAuthModalOpen, setBuyCreditsModalOpen, features } = useStore();
  const { characters, status, reload } = useMyCharacters(!!user);

  if (!user) {
    return (
      <EmptyState
        title="Accedi per vedere il tuo profilo"
        action={
          <Button variant="primary" onClick={() => setAuthModalOpen(true, 'login')}>
            Accedi
          </Button>
        }
      />
    );
  }

  const planLabel =
    user.subscription === 'monthly' ? 'Mensile' : user.subscription === 'annual' ? 'Annuale' : 'Gratuito';

  return (
    <PageContainer>
      <PageHeader
        media={<Avatar src={user.avatar} name={user.username} size={72} rounded="full" />}
        eyebrow="Il tuo account"
        title={`@${user.username}`}
        description={user.email}
        actions={
          <ButtonLink to="/settings">
            <Settings className="h-4 w-4" aria-hidden="true" /> Impostazioni
          </ButtonLink>
        }
      />

      {/* Le tre cifre che contano, su un filo invece che dentro tre riquadri. */}
      <div className="rule grid grid-cols-2 gap-x-8 gap-y-8 pt-7 sm:grid-cols-3">
        <Stat
          label="Crediti"
          value={user.credits}
          hint={
            features.payments ? (
              /* Un bersaglio da 60×16 px non si centra con un dito: l'altezza
                 minima la porta ora il componente, per tutti i pulsanti. */
              <Button variant="ghost" size="sm" className="-ml-3" onClick={() => setBuyCreditsModalOpen(true)}>
                <Coins className="h-3.5 w-3.5" aria-hidden="true" /> Ricarica
              </Button>
            ) : (
              'Crediti della beta'
            )
          }
        />
        <Stat
          label="Piano"
          value={planLabel}
          hint={
            user.subscription !== 'free' && user.subscriptionExpiresAt
              ? `Attivo fino al ${new Date(user.subscriptionExpiresAt).toLocaleDateString('it-IT')}`
              : undefined
          }
        />
        <Stat label="Uso di oggi" value={user.dailyMessageCount} hint="messaggi inviati" />
      </div>

      {/* Personaggi creati — l'endpoint esisteva e non era mai stato collegato */}
      <section className="mt-16">
        <div className="rule mb-7 flex items-baseline justify-between gap-4 pt-5">
          <h2 className="title-display text-display-sm">I miei personaggi</h2>
          <ButtonLink to="/create" size="sm">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Nuovo
          </ButtonLink>
        </div>

        {status === 'loading' && <CardSkeleton count={3} />}
        {status === 'error' && <ErrorState title="Impossibile caricare i tuoi personaggi" onRetry={reload} />}

        {status === 'ready' && characters.length === 0 && (
          <EmptyState
            icon={<Sparkles className="h-7 w-7" />}
            title="Non hai ancora creato nessun personaggio"
            description="Creane uno: puoi tenerlo privato o pubblicarlo in galleria."
            action={
              <ButtonLink to="/create" variant="primary">
                Crea il primo
              </ButtonLink>
            }
          />
        )}

        {status === 'ready' && characters.length > 0 && (
          <div className="grid gap-x-8 gap-y-14 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
            {characters.map((c) => (
              <CharacterCard key={c._id} character={c} />
            ))}
          </div>
        )}
      </section>
    </PageContainer>
  );
}
