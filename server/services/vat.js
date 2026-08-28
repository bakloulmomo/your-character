/**
 * IVA sulle vendite digitali B2C nell'Unione (FASE D — S2-12).
 *
 * Per i servizi digitali venduti a consumatori l'IVA è dovuta nel paese del
 * CLIENTE, non del venditore (regime OSS). Prima non esisteva alcun calcolo:
 * ogni transazione registrava un importo lordo come numero a virgola mobile e
 * nient'altro — nessuna aliquota, nessun imponibile, nessun paese, nessuna
 * ricevuta. Non era possibile né dichiarare l'imposta né darne conto al cliente.
 *
 * Due scelte esplicite:
 *
 * 1. Tutti gli importi sono INTERI in centesimi. `0.1 + 0.2 !== 0.3` in virgola
 *    mobile: su un registro di denaro è un difetto, non una curiosità.
 *
 * 2. I prezzi di listino sono IVA INCLUSA, come richiesto per i consumatori:
 *    l'imponibile si ricava dal lordo, non viceversa.
 */

/**
 * Aliquote ordinarie IVA degli Stati membri UE.
 *
 * ATTENZIONE: le aliquote cambiano per legge. Questa tabella è una fotografia e
 * va rivista periodicamente; `RATES_REVIEWED_ON` dice a quando risale, così chi
 * la legge sa quanto fidarsi invece di doverlo indovinare.
 */
const RATES_REVIEWED_ON = '2026-08-28';

const EU_VAT_RATES = {
  AT: 20, BE: 21, BG: 20, CY: 19, CZ: 21, DE: 19, DK: 25, EE: 22, ES: 21,
  FI: 25.5, FR: 20, GR: 24, HR: 25, HU: 27, IE: 23, IT: 22, LT: 21, LU: 17,
  LV: 21, MT: 18, NL: 21, PL: 23, PT: 23, RO: 21, SE: 25, SI: 22, SK: 23
};

const isEuCountry = (country) => Object.prototype.hasOwnProperty.call(EU_VAT_RATES, String(country || '').toUpperCase());

/**
 * Aliquota applicabile a un cliente.
 * Fuori dall'Unione l'IVA europea non si applica: 0, e la ricevuta lo dichiara
 * invece di far finta che il paese non esista.
 */
const rateFor = (country) => {
  const code = String(country || '').toUpperCase();
  return isEuCountry(code) ? EU_VAT_RATES[code] : 0;
};

/**
 * Scompone un importo lordo (IVA inclusa) in imponibile e imposta.
 *
 * @param {number} grossCents importo pagato dal cliente, in centesimi interi
 * @param {string} country    paese del cliente (ISO 3166-1 alpha-2)
 * @returns {{grossCents:number, netCents:number, vatCents:number, vatRate:number, country:string, euVat:boolean}}
 */
function breakdown(grossCents, country) {
  const gross = Math.round(Number(grossCents) || 0);
  const code = String(country || '').toUpperCase();
  const vatRate = rateFor(code);

  // L'imposta si arrotonda una volta sola, e l'imponibile è ciò che resta:
  // arrotondando entrambi separatamente la somma potrebbe non tornare al lordo.
  const netCents = vatRate > 0 ? Math.round(gross / (1 + vatRate / 100)) : gross;
  const vatCents = gross - netCents;

  return {
    grossCents: gross,
    netCents,
    vatCents,
    vatRate,
    country: code || null,
    euVat: isEuCountry(code)
  };
}

/** Formattazione per l'interfaccia e per le ricevute. */
const formatCents = (cents, currency = 'EUR') =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format((Number(cents) || 0) / 100);

module.exports = {
  EU_VAT_RATES,
  RATES_REVIEWED_ON,
  isEuCountry,
  rateFor,
  breakdown,
  formatCents
};
