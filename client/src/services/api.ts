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
  } else {
    // Optional fallback for legacy test mock headers if explicit
    const mockId = localStorage.getItem('yc_mock_clerk_id');
    if (mockId) {
      config.headers['x-mock-clerk-id'] = mockId;
      config.headers['x-mock-email'] = `${mockId}@demo.your-character.app`;
      config.headers['x-mock-username'] = 'demo_user';
    }
  }
  return config;
});

export default api;

