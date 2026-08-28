/**
 * Sbarramento per funzionalità spente.
 *
 * Nascondere un pulsante non spegne una funzione: la rotta resta raggiungibile
 * con una richiesta HTTP diretta, e chi volesse aggirarla non passa certo
 * dall'interfaccia. L'interruttore va applicato QUI, dove la funzione vive
 * davvero; l'interfaccia si limita a non offrire ciò che non c'è.
 *
 * Risponde 404 e non 403: una funzione disattivata non esiste, e l'esistenza
 * di un percorso di pagamento non ancora aperto non è un'informazione da
 * regalare. È la stessa scelta già fatta per `requireRole`.
 */
const { features } = require('../config/env');

const requireFeature = (name) => (req, res, next) => {
  if (!features()[name]) {
    return res.status(404).json({
      error: 'Funzione non disponibile',
      feature: name,
      disabled: true
    });
  }
  next();
};

module.exports = { requireFeature };
