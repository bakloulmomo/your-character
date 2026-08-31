const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { isProduction } = require('../config/env');
const logger = require('./logger');

/**
 * Archiviazione dei file binari generati (immagini).
 *
 * Prima le immagini venivano salvate come data-URI base64 dentro il documento
 * del messaggio: ogni immagine reale gonfiava il documento di centinaia di
 * kilobyte, rallentava ogni lettura della cronologia e avvicinava il limite di
 * 16 MB per documento di MongoDB (S1-15). In database va solo l'URL.
 *
 * Due implementazioni dietro la stessa interfaccia:
 *  - `cloudinary`  quando CLOUDINARY_URL è configurato (produzione)
 *  - `local`       cartella servita staticamente, per lo sviluppo
 */

const LOCAL_DIR = path.join(__dirname, '..', 'uploads');
const PUBLIC_PREFIX = '/uploads';

const provider = () => (process.env.CLOUDINARY_URL ? 'cloudinary' : 'local');

async function storeLocally(buffer, extension) {
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  const filename = `${crypto.randomUUID()}.${extension}`;
  await fs.writeFile(path.join(LOCAL_DIR, filename), buffer);

  const base = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5001}`;
  return `${base}${PUBLIC_PREFIX}/${filename}`;
}

async function storeOnCloudinary(buffer, extension) {
  // Upload non firmato tramite REST: evita di aggiungere l'SDK completo.
  const url = process.env.CLOUDINARY_URL;
  const match = url.match(/^cloudinary:\/\/(\d+):([^@]+)@(.+)$/);
  if (!match) throw new Error('CLOUDINARY_URL malformato');

  const [, apiKey, apiSecret, cloudName] = match;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHash('sha1')
    .update(`timestamp=${timestamp}${apiSecret}`)
    .digest('hex');

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: `image/${extension}` }));
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('signature', signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: form
  });

  if (!response.ok) {
    throw new Error(`Cloudinary ha risposto ${response.status}`);
  }

  const data = await response.json();
  return data.secure_url;
}

/**
 * Salva un'immagine e restituisce l'URL con cui referenziarla.
 * @param {Buffer} buffer
 * @param {string} extension - 'jpeg', 'png', ...
 * @returns {Promise<string>} URL pubblico
 */
async function storeImage(buffer, extension = 'jpeg') {
  if (provider() === 'cloudinary') {
    return storeOnCloudinary(buffer, extension);
  }

  if (isProduction()) {
    // Il disco locale di un'istanza serverless è effimero: l'immagine
    // sparirebbe al primo riavvio. Meglio dirlo che perdere i file.
    logger.warn('CLOUDINARY_URL non configurato: le immagini sono salvate su disco locale e andranno perse al riavvio.');
  }

  return storeLocally(buffer, extension);
}

module.exports = { storeImage, LOCAL_DIR, PUBLIC_PREFIX };
