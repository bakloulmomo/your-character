const mongoose = require('mongoose');
const User = require('../models/User');
const Character = require('../models/Character');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Transaction = require('../models/Transaction');
const Report = require('../models/Report');
const { createCharacterSchema, sendMessageSchema } = require('../utils/validation');

describe('Mongoose Models & Zod Schemas Unit Tests', () => {
  it('should instantiate User model with correct default credits and methods', () => {
    const user = new User({
      clerkId: 'clerk_test_123',
      email: 'test@example.com',
      username: 'testuser'
    });

    expect(user.credits).toBe(10);
    expect(user.subscription).toBe('free');
    expect(user.canSendMessage()).toBe(true);
    expect(user.canGenerateImage()).toBe(true);
  });

  it('should validate character creation schema with Zod', () => {
    const validData = {
      name: 'Test Character',
      description: 'Questa è una descrizione valida di oltre 10 caratteri.',
      personality: 'Questa è una personalità valida di oltre 20 caratteri per il character.',
      avatar: 'https://example.com/avatar.jpg',
      category: 'fantasy'
    };

    const parsed = createCharacterSchema.safeParse(validData);
    expect(parsed.success).toBe(true);
  });

  it('should reject invalid message schemas with Zod', () => {
    const invalidMessage = {
      chatId: 'invalid-id',
      content: ''
    };

    const parsed = sendMessageSchema.safeParse(invalidMessage);
    expect(parsed.success).toBe(false);
  });

  it('should instantiate Report model with valid status', () => {
    const reporterId = new mongoose.Types.ObjectId();
    const targetId = new mongoose.Types.ObjectId();

    const report = new Report({
      reporterId,
      targetType: 'character',
      targetId,
      reason: 'hate_speech',
      description: 'Contenuto non appropriato'
    });

    expect(report.status).toBe('pending');
    expect(report.reason).toBe('hate_speech');
  });
});
