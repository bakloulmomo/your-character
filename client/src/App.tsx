import { useEffect, type ReactNode } from 'react';
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
import RouteError from './components/RouteError';
import LandingPage from './pages/LandingPage';
import PricingPage from './pages/PricingPage';
import FaqPage from './pages/FaqPage';
import ContactsPage from './pages/ContactsPage';
import CookiePolicyPage from './pages/CookiePolicyPage';

/**
 * Router reale con indirizzi propri.
 *
 * Prima la navigazione era uno switch su una variabile di stato: ricaricare la
 * pagina in una chat riportava alla home, il tasto indietro usciva dal sito e
 * nessuna schermata era condivisibile (S3-5).
 */
/**
 * Ogni rotta porta il proprio `errorElement`.
 *
 * Prima l'unica rete era l'`ErrorBoundary` attorno a tutta l'applicazione: un
 * errore di render nella scheda di un personaggio portava via anche la barra
 * laterale, la cronologia e la navigazione. Qui il guasto resta dentro l'area
 * del contenuto e il guscio sopravvive, quindi si può andare altrove con un
 * click invece di ricaricare.
 *
 * In un router «dati» come questo, un errore risale alla rotta più vicina che
 * ne dichiara uno: senza questa riga su OGNI figlia, salirebbe fino al guscio.
 */
const conRete = (path: string, element: ReactNode) => ({ path, element, errorElement: <RouteError /> });

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      /**
       * Il catalogo si è spostato da `/` a `/discover`.
       *
       * `/` era la griglia dei personaggi: chi arrivava senza sapere che cos'è
       * `your-character` trovava volti sconosciuti e nessuna frase che lo
       * spiegasse. Ora `/` è la presentazione — fuori da questo guscio, perché
       * una pagina di ingresso non ha bisogno della barra laterale né della
       * cronologia di conversazioni che il visitatore non ha.
       */
      conRete('discover', <DiscoverPage />),
      conRete('search', <SearchPage />),
      conRete('character/:id', <CharacterPage />),
      conRete('chat/:chatId', <ChatPage />),
      conRete('create', <CreateCharacterPage />),
      conRete('profile', <ProfilePage />),
      conRete('settings', <SettingsPage />),
      // Coda di revisione: il server risponde 404 a chi non ha il ruolo,
      // quindi questa rotta è un ingresso, non un permesso.
      conRete('moderation', <ModerationPage />),
      // Un indirizzo inesistente è lo stesso schermo di un guasto, con un testo
      // diverso: `RouteError` distingue i due casi da sé.
      conRete('*', <RouteError />)
    ]
  },
  /**
   * Le pagine PUBBLICHE stanno fuori dal guscio dell'applicazione.
   *
   * Presentazione, prezzi, domande e contatti hanno un'intestazione e un piede
   * di pagina propri (`MarketingLayout`): la barra laterale con «le tue chat»
   * non ha senso per chi non ha ancora un account, e occuperebbe un quarto
   * dello schermo per non dire niente.
   */
  { path: '/', element: <LandingPage />, errorElement: <RouteError /> },
  { path: '/prezzi', element: <PricingPage />, errorElement: <RouteError /> },
  { path: '/faq', element: <FaqPage />, errorElement: <RouteError /> },
  { path: '/contatti', element: <ContactsPage />, errorElement: <RouteError /> },
  { path: '/cookie-policy', element: <CookiePolicyPage />, errorElement: <RouteError /> },

  // Le pagine legali restano fuori dal guscio: sono documenti a sé.
  { path: '/terms', element: <TermsPage />, errorElement: <RouteError /> },
  // Destinazione del link inviato per email: deve funzionare da sola, senza
  // che l'utente sia autenticato.
  { path: '/reset-password', element: <ResetPasswordPage />, errorElement: <RouteError /> },
  { path: '/privacy', element: <PrivacyPage />, errorElement: <RouteError /> },
  { path: '/index.html', element: <Navigate to="/" replace /> },
  /**
   * Chi ha salvato un segnalibro sulla vecchia radice-catalogo non deve
   * trovarsi altrove senza spiegazione. `/pricing` c'è perché il piano di
   * lavoro lo nominava in inglese, mentre ogni altro indirizzo del prodotto è
   * in italiano: la pagina sta su `/prezzi` e questo è solo un rinvio.
   */
  { path: '/pricing', element: <Navigate to="/prezzi" replace /> }
]);

export default function App() {
  const { setUser, setAuthResolved, setToken, setConfig } = useStore();

  // Quali funzioni sono accese su questa istanza. Va chiesto PRIMA di disegnare
  // i comandi: l'alternativa e' mostrare pulsanti che spariscono un istante
  // dopo, o peggio che restano e portano a un 404.
  useEffect(() => {
    api
      .get('/config')
      .then((res) => {
        if (res.data?.features) {
          setConfig({
            features: res.data.features,
            inviteRequired: !!res.data.inviteRequired,
            paymentsMode: res.data.paymentsMode === 'live' ? 'live' : 'mock'
          });
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
      .catch(() => {
        /**
         * Qui si ripulisce SOLO lo stato locale.
         *
         * Prima questo ramo chiamava `logout()`, che parla anche col server.
         * Due conseguenze, entrambe sbagliate: ogni visitatore anonimo faceva
         * partire una POST /auth/logout inutile a ogni caricamento, e — molto
         * peggio — un errore di rete passeggero su /auth/me faceva cancellare
         * al server il cookie di sessione. Bastava un istante di connessione
         * incerta all'avvio per ritrovarsi disconnessi davvero.
         */
        setUser(null);
        setToken(null);
      })
      .finally(() => setAuthResolved(true));
  }, [setUser, setToken, setAuthResolved]);

  return <RouterProvider router={router} />;
}
