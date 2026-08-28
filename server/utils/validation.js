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

module.exports = {
  createCharacterSchema,
  sendMessageSchema,
  createChatSchema,
  createReportSchema,
  generateImageSchema
};
