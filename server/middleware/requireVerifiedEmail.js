/**
 * Cancello: questa azione richiede un indirizzo email confermato.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DOVE SI APPLICA, E PERCHE' NON DAPPERTUTTO.
 *
 * Chiudere l'intera applicazione dietro la conferma sarebbe piu' semplice da
 * scrivere e peggio da usare: chi arriva vuole vedere che cosa ha davanti prima
 * di andare a cercare un codice nella posta, e un prodotto che si presenta con
 * un muro perde le persone prima di essersi spiegato. Restano quindi aperti il
 * catalogo, il profilo, le impostazioni e le pagine legali.
 *
 * Si chiude ESATTAMENTE cio' che costa a noi o vincola qualcun altro:
 *
 *  · inviare messaggi — consuma quota del modello, cioe' denaro, ed e' la leva
 *    che rende conveniente registrare account con indirizzi altrui;
 *  · creare personaggi e aprire conversazioni — scrive contenuto pubblico e
 *    lascia documenti attaccati a un account che il TTL potrebbe cancellare;
 *  · comprare crediti — legare un pagamento a un'email che non e' di chi paga
 *    significa mandare la ricevuta alla persona sbagliata.
 *
 * La risposta e' 403 con `requiresEmailVerification: true`: il client apre il
 * pannello del codice invece di mostrare un errore generico. Non e' 401 —
 * l'utente E' autenticato, gli manca un requisito, e confondere le due cose
 * farebbe scattare la disconnessione automatica nell'intercettore del client.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function requireVerifiedEmail(req, res, next) {
  // Il cancello si monta sempre dopo `requireAuth`: se qui non c'e' un utente
  // e' un errore di montaggio, e va trattato come un rifiuto, non ignorato.
  if (!req.user) {
    return res.status(401).json({ error: 'Autenticazione richiesta' });
  }

  if (req.user.emailVerifiedAt) return next();

  return res.status(403).json({
    error: 'Conferma il tuo indirizzo email per continuare. Ti abbiamo inviato un codice.',
    requiresEmailVerification: true,
    email: req.user.email
  });
}

module.exports = { requireVerifiedEmail };
