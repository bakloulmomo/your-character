const mongoose = require('mongoose');
const { z } = require('zod');

// Character Validation Schemas
const createCharacterSchema = z.object({
  name: z.string().min(2, 'Il nome deve contenere almeno 2 caratteri').max(60, 'Nome troppo lungo'),
  description: z.string().min(10, 'La descrizione deve contenere almeno 10 caratteri').max(500),
  personality: z.string().min(20, 'La personalità deve contenere almeno 20 caratteri').max(2000),
  backstory: z.string().max(1500).optional().default(''),
  greetingMessage: z.string().max(300).optional().default('Ciao! Di cosa vorresti parlare oggi?'),
  // `.or(z.string().min(1))` annullava completamente il vincolo: qualsiasi
  // stringa passava, incluso `javascript:alert(1)`. Sono ammessi solo http/https.
  avatar: z.string()
    .url('URL Avatar non valido')
    .refine((u) => /^https?:\/\//i.test(u), 'L\'avatar deve essere un URL http o https'),
  tags: z.array(z.string()).max(10).optional().default([]),
  category: z.enum(['anime', 'gaming', 'assistant', 'historical', 'fantasy', 'roleplay', 'custom']).optional().default('custom'),
  isPublic: z.boolean().optional().default(false),
  isNSFW: z.boolean().optional().default(false)
});

// Message Validation Schemas
const sendMessageSchema = z.object({
  chatId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID Chat non valido'),
  content: z.string().min(1, 'Il messaggio non può essere vuoto').max(4000, 'Messaggio troppo lungo (max 4000 caratteri)')
});

// Chat Creation Schema
const createChatSchema = z.object({
  characterId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID Character non valido'),
  title: z.string().max(100).optional()
});

// Report Validation Schema
const createReportSchema = z.object({
  targetType: z.enum(['character', 'message', 'user']),
  targetId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID target non valido'),
  reason: z.enum(['hate_speech', 'harassment', 'nsfw_unmarked', 'copyright', 'spam', 'other']),
  description: z.string().max(1000).optional().default('')
});

// Image Generation Schema
const generateImageSchema = z.object({
  chatId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID Chat non valido'),
  prompt: z.string().min(3, 'Il prompt deve contenere almeno 3 caratteri').max(1000)
});

/**
 * Un identificativo che Mongoose può convertire senza lanciare (S11).
 *
 * Vive qui perché era già scritto DUE volte, identico, in `routes/characters.js`
 * e `routes/admin.js` — e mancava nelle sei rotte che ne avevano bisogno:
 * `PUT`/`DELETE` di un personaggio, `GET`/`DELETE` di una conversazione e due
 * punti dei messaggi. Là un identificativo malformato arrivava a Mongoose, che
 * sollevava `CastError`, che diventava un 500 con lo stack in Sentry — mentre
 * la risposta giusta è 400 o 404. Costo zero per chi lo provoca, rumore per chi
 * guarda il monitoraggio, e la semantica sbagliata per chi ha solo sbagliato a
 * incollare un indirizzo.
 *
 * Il doppio controllo non è ridondante: `ObjectId.isValid` accetta anche
 * qualunque stringa di 12 caratteri, quindi da solo lascerebbe passare
 * `'personaggio1'`.
 */
const isValidObjectId = (id) =>
  typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id) && mongoose.Types.ObjectId.isValid(id);

/**
 * Le regole della password — una sola volta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Erano scritte a mano in QUATTRO posti: la registrazione e il reset in
 * `routes/auth.js`, e di nuovo in `AuthModal.tsx` e `ResetPasswordPage.tsx` sul
 * client. Quattro copie della stessa regola non restano uguali: basta che una
 * sola venga irrobustita perche' l'interfaccia accetti una password che il
 * server rifiuta, o — peggio — perche' il client mostri tre requisiti mentre il
 * server ne applica quattro, e l'utente non capisca che cosa gli manca.
 *
 * Le tre copie lato server diventano una. Le due lato client non possono
 * leggere questo file, ma ora hanno una controparte unica da rispecchiare, e
 * `PASSWORD_RULES` e' l'elenco da cui derivare i requisiti mostrati.
 *
 * Perche' NON e' piu' severa di cosi'. Otto caratteri con una maiuscola e una
 * cifra non e' una regola forte: il vero rischio e' il riuso di una password
 * gia' compromessa altrove, e nessun requisito di composizione lo intercetta.
 * Irrigidire la forma spinge verso `Password1!` — piu' complicata da ricordare
 * e non piu' difficile da indovinare. La difesa che conta e' altrove: costo
 * bcrypt 12, limite di tentativi, e revoca via `tokenVersion`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const PASSWORD_RULES = [
  { test: (v) => v.length >= 8, message: 'La password deve contenere almeno 8 caratteri' },
  { test: (v) => /[A-Z]/.test(v), message: 'La password deve contenere almeno una lettera maiuscola' },
  { test: (v) => /[0-9]/.test(v), message: 'La password deve contenere almeno un numero' }
];

/**
 * Lo schema Zod corrispondente.
 *
 * `.max(200)`: bcrypt tronca silenziosamente a 72 byte, quindi oltre quella
 * soglia i caratteri in piu' non contano nulla — ma senza un tetto esplicito
 * una password da un megabyte diventa lavoro di hashing gratuito per chi la
 * invia. Duecento e' abbondante per qualunque frase segreta reale.
 */
const passwordSchema = PASSWORD_RULES.reduce(
  (schema, regola) => schema.refine(regola.test, regola.message),
  z.string().max(200, 'Password troppo lunga')
);

module.exports = {
  isValidObjectId,
  PASSWORD_RULES,
  passwordSchema,
  createCharacterSchema,
  sendMessageSchema,
  createChatSchema,
  createReportSchema,
  generateImageSchema
};
