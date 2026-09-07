import axios from 'axios';

/**
 * Token della sessione corrente, tenuto qui in modulo.
 *
 * Lo store lo deposita con `setAuthToken` invece di essere importato da questo
 * file: importarlo creerebbe un ciclo (lo store importa gia' `api` per il
 * logout). Il ciclo funzionerebbe, perche' entrambi gli usi sono differiti,
 * ma appoggiarsi all'ordine di valutazione dei moduli e' il genere di cosa che
 * regge in sviluppo e si rompe in una build ottimizzata.
 *
 * Non e' persistito da nessuna parte: dopo un ricaricamento riparte vuoto e la
 * sessione viene ricostruita dal cookie httpOnly.
 */
let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

/**
 * L'API e' same-origin: in sviluppo grazie al proxy di Vite, in produzione
 * grazie alla riscrittura di Vercel. E' cio' che permette al cookie di
 * sessione httpOnly di viaggiare da solo, senza che nessuno script debba
 * conservare un token da qualche parte.
 */
const api = axios.create({
  baseURL: '/api',
  // I cookie same-origin viaggerebbero comunque; dichiararlo rende esplicito
  // che la sessione sta li' e non in un'intestazione ricostruita a mano.
  withCredentials: true,
  /**
   * Un tetto al tempo di attesa.
   *
   * Non ce n'era nessuno, e il backend sta su un piano gratuito che si spegne
   * dopo quindici minuti di inattivita': la prima richiesta dopo una pausa puo'
   * impiegare una cinquantina di secondi per il riavvio a freddo. Senza
   * timeout una richiesta puo' restare appesa per sempre, e nessuno stato
   * dell'interfaccia se ne accorge: la rotella gira e basta.
   *
   * Sessanta secondi sono scelti sopra il riavvio a freddo di proposito — un
   * valore piu' basso trasformerebbe una lentezza prevista in un errore — ma
   * finiti quelli l'utente riceve un messaggio invece di un'attesa infinita.
   */
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Interceptor to add JWT Authorization header if authenticated
api.interceptors.request.use((config) => {
  // Il token in memoria copre le richieste della sessione corrente; dopo un
  // ricaricamento non c'e' piu' e subentra il cookie httpOnly.
  const token = authToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  /**
   * Il ripiego sugli header di mock e' stato RIMOSSO.
   *
   * Leggeva `localStorage['yc_mock_clerk_id']` e, se lo trovava, aggiungeva
   * `x-mock-clerk-id`, `x-mock-email` e `x-mock-username` — le intestazioni con
   * cui il server, dentro `if (isTest())`, impersona un account qualsiasi.
   *
   * Non era sfruttabile: fuori dai test quel ramo del server non esiste. Ma era
   * codice di impersonificazione spedito nel pacchetto di produzione, cioe' una
   * cosa che smette di essere innocua nel momento esatto in cui qualcuno,
   * un giorno, allarga quella condizione lato server per far girare uno
   * staging. Nessun test dell'interfaccia lo usa.
   */
  return config;
});

/**
 * Una sessione scaduta si nota una volta sola, qui.
 *
 * Non c'era alcun interceptor di risposta: ogni hook gestiva il 401 per conto
 * proprio, il che significa che chi se ne dimenticava lasciava l'utente in una
 * pagina che sembrava funzionare e non funzionava. Il token in memoria viene
 * dimenticato subito; il resto lo decide l'interfaccia, che riceve comunque
 * l'errore e puo' chiedere di rientrare.
 *
 * Le rotte anonime restano fuori: `/auth/me` risponde 401 a ogni visitatore non
 * connesso, ed e' un esito previsto, non una sessione scaduta.
 */
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error?.config?.url ?? '';
    const anonimaPrevista = url.includes('/auth/me') || url.includes('/auth/login');
    if (error?.response?.status === 401 && !anonimaPrevista) {
      authToken = null;
    }
    return Promise.reject(error);
  }
);

export default api;

