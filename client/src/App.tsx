import { useEffect } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import api from './services/api';
import { useStore } from './store/useStore';
import AppShell from './components/AppShell';
import DiscoverPage from './pages/DiscoverPage';
import SearchPage from './pages/SearchPage';
import CharacterPage from './pages/CharacterPage';
import ChatPage from './pages/ChatPage';
import CreateCharacterPage from './pages/CreateCharacterPage';
import ProfilePage from './pages/ProfilePage';
import SettingsPage from './pages/SettingsPage';
import ModerationPage from './pages/ModerationPage';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import { EmptyState } from './components/ui/States';

/**
 * Router reale con indirizzi propri.
 *
 * Prima la navigazione era uno switch su una variabile di stato: ricaricare la
 * pagina in una chat riportava alla home, il tasto indietro usciva dal sito e
 * nessuna schermata era condivisibile (S3-5).
 */
const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DiscoverPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'character/:id', element: <CharacterPage /> },
      { path: 'chat/:chatId', element: <ChatPage /> },
      { path: 'create', element: <CreateCharacterPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'settings', element: <SettingsPage /> },
      // Coda di revisione: il server risponde 404 a chi non ha il ruolo,
      // quindi questa rotta è un ingresso, non un permesso.
      { path: 'moderation', element: <ModerationPage /> },
      {
        path: '*',
        element: (
          <EmptyState
            title="Pagina non trovata"
            description="L'indirizzo che hai aperto non esiste."
            action={<a href="/" className="btn-secondary rounded-xl px-4 py-2 text-sm">Torna alla home</a>}
          />
        )
      }
    ]
  },
  // Le pagine legali restano fuori dal guscio: sono documenti a sé.
  { path: '/terms', element: <TermsPage /> },
  // Destinazione del link inviato per email: deve funzionare da sola, senza
  // che l'utente sia autenticato.
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/privacy', element: <PrivacyPage /> },
  { path: '/index.html', element: <Navigate to="/" replace /> }
]);

export default function App() {
  const { setUser, setAuthResolved, logout, setConfig } = useStore();

  // Quali funzioni sono accese su questa istanza. Va chiesto PRIMA di disegnare
  // i comandi: l'alternativa e' mostrare pulsanti che spariscono un istante
  // dopo, o peggio che restano e portano a un 404.
  useEffect(() => {
    api
      .get('/config')
      .then((res) => {
        if (res.data?.features) {
          setConfig({ features: res.data.features, inviteRequired: !!res.data.inviteRequired });
        }
      })
      .catch(() => {
        // Server irraggiungibile: si resta sul valore iniziale, cioe' tutto
        // spento. Meglio un'interfaccia che offre meno del vero che una che
        // promette funzioni irraggiungibili.
      });
  }, [setConfig]);

  // Verifica la sessione all'avvio. Nessun ritardo artificiale: prima c'era un
  // timer fisso di 600 ms indipendente da qualunque caricamento reale (S3-30).
  useEffect(() => {
    // Si chiede SEMPRE, anche senza token in memoria: dopo un ricaricamento la
    // sessione vive nel cookie httpOnly, che questo codice non puo' vedere. Un
    // visitatore anonimo riceve un 401 e prosegue come anonimo.
    api
      .get('/auth/me')
      .then((res) => {
        if (res.data?.user) setUser(res.data.user);
      })
      .catch(() => logout())
      .finally(() => setAuthResolved(true));
  }, [setUser, setAuthResolved, logout]);

  return <RouterProvider router={router} />;
}
