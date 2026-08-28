import { Link } from 'react-router-dom';
import { Plus, Sparkles, Coins, Settings } from 'lucide-react';
import { useMyCharacters } from '../hooks/useCharacters';
import { useStore } from '../store/useStore';
import CharacterCard from '../components/CharacterCard';
import Avatar from '../components/ui/Avatar';
import { CardSkeleton, EmptyState, ErrorState } from '../components/ui/States';

export default function ProfilePage() {
  const { user, setAuthModalOpen, setBuyCreditsModalOpen, features } = useStore();
  const { characters, status, reload } = useMyCharacters(!!user);

  if (!user) {
    return (
      <EmptyState
        title="Accedi per vedere il tuo profilo"
        action={
          <button onClick={() => setAuthModalOpen(true, 'login')} className="btn-primary rounded-xl px-4 py-2 text-sm">
            Accedi
          </button>
        }
      />
    );
  }

  const planLabel =
    user.subscription === 'monthly' ? 'Mensile' : user.subscription === 'annual' ? 'Annuale' : 'Gratuito';

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar src={user.avatar} name={user.username} size={64} rounded="full" />
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">@{user.username}</h1>
            <p className="text-sm text-ink-muted">{user.email}</p>
          </div>
        </div>

        <Link to="/settings" className="btn-secondary flex items-center gap-1.5 self-start rounded-xl px-4 py-2 text-sm">
          <Settings className="h-4 w-4" aria-hidden="true" /> Impostazioni
        </Link>
      </header>

      {/* Riepilogo del piano */}
      <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-dim">Crediti</p>
          <p className="mt-1 font-display text-2xl font-bold text-ink">{user.credits}</p>
          {features.payments ? (
            <button onClick={() => setBuyCreditsModalOpen(true)} className="mt-2 flex items-center gap-1 text-xs text-sapphire-glow hover:underline">
              <Coins className="h-3 w-3" aria-hidden="true" /> Ricarica
            </button>
          ) : (
            <p className="mt-2 text-xs text-ink-dim">Crediti della beta</p>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-dim">Piano</p>
          <p className="mt-1 font-display text-2xl font-bold text-ink">{planLabel}</p>
          {user.subscription !== 'free' && user.subscriptionExpiresAt && (
            <p className="mt-2 text-xs text-ink-dim">
              Attivo fino al {new Date(user.subscriptionExpiresAt).toLocaleDateString('it-IT')}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-dim">Uso di oggi</p>
          <p className="mt-1 font-display text-2xl font-bold text-ink">{user.dailyMessageCount}</p>
          <p className="mt-2 text-xs text-ink-dim">messaggi inviati</p>
        </div>
      </div>

      {/* Personaggi creati — l'endpoint esisteva e non era mai stato collegato */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink">I miei personaggi</h2>
          <Link to="/create" className="btn-secondary flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Nuovo
          </Link>
        </div>

        {status === 'loading' && <CardSkeleton count={3} />}
        {status === 'error' && <ErrorState title="Impossibile caricare i tuoi personaggi" onRetry={reload} />}

        {status === 'ready' && characters.length === 0 && (
          <EmptyState
            icon={<Sparkles className="h-7 w-7" />}
            title="Non hai ancora creato nessun personaggio"
            description="Creane uno: puoi tenerlo privato o pubblicarlo in galleria."
            action={<Link to="/create" className="btn-primary rounded-xl px-4 py-2 text-sm">Crea il primo</Link>}
          />
        )}

        {status === 'ready' && characters.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {characters.map((c) => (
              <CharacterCard key={c._id} character={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
