const axios = require('axios');
const { imageMode } = require('../config/env');
const { storeImage } = require('./storageService');
const logger = require('./logger');

const STABILITY_URL = 'https://api.stability.ai/v2beta/stable-image/generate/sd3';
const STABILITY_TIMEOUT_MS = 60000;

// Segnaposto usato quando il generatore non è collegato. Non è una foto
// "curata": è un segnaposto dichiarato, e non viene fatturato.
const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1024&q=80';

/**
 * Generates an AI image based on prompt
 * @param {string} prompt - Prompt description
 * @param {string} [aspectRatio='1:1'] - Aspect ratio
 * @returns {Promise<{url: string, cost: number}>}
 */
async function generateImage(prompt, aspectRatio = '1:1') {
  const mode = imageMode();

  if (mode === 'fail') {
    throw new Error('Guasto simulato del generatore di immagini');
  }

  // Nessuna chiave configurata fuori produzione: si restituisce un segnaposto
  // esplicito e NON fatturabile. Prima si addebitavano 10 crediti per una foto
  // di repertorio scelta a caso, senza alcun rapporto con il prompt.
  if (mode === 'degraded' || mode === 'stub') {
    return {
      url: PLACEHOLDER_IMAGE,
      cost: 0,
      mode,
      billable: mode === 'stub',
      placeholder: mode === 'degraded'
    };
  }

  try {
    const response = await axios.post(
      STABILITY_URL,
      { prompt, output_format: 'jpeg', aspect_ratio: aspectRatio },
      {
        headers: {
          Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
          Accept: 'application/json'
        },
        timeout: STABILITY_TIMEOUT_MS
      }
    );

    // L'immagine va nell'archivio dei file, non nel documento del messaggio:
    // in database resta solo l'URL (S1-15).
    const buffer = Buffer.from(response.data.image, 'base64');
    const url = await storeImage(buffer, 'jpeg');

    return {
      url,
      cost: 0.025,
      mode,
      billable: true,
      placeholder: false
    };
  } catch (error) {
    logger.error({ err: { message: error.message } }, 'Generazione immagine non riuscita');
    throw new Error('Impossibile generare l\'immagine al momento. Riprova più tardi.');
  }
}

module.exports = { generateImage };
