const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');
const Character = require('../models/Character');

let mongoServer;

describe('API & Authentication Integration Tests', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  }, 30000);

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Character.deleteMany({})
    ]);
  });

  it('should return 401 Unauthorized when requesting /api/users/me without auth token', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('should authenticate user and return profile on GET /api/users/me with mock auth headers', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('x-mock-clerk-id', 'clerk_test_user_99')
      .set('x-mock-email', 'testuser99@example.com')
      .set('x-mock-username', 'testuser99');

    expect(res.status).toBe(200);
    expect(res.body.user).toHaveProperty('email', 'testuser99@example.com');
    expect(res.body.user.credits).toBe(10);
  });

  it('should reject invalid character creation payload with HTTP 400', async () => {
    const res = await request(app)
      .post('/api/characters')
      .set('x-mock-clerk-id', 'clerk_test_user_99')
      .send({
        name: 'A', // Too short
        description: 'short'
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Dati di input non validi');
  });

  it('should create character successfully with valid payload', async () => {
    const res = await request(app)
      .post('/api/characters')
      .set('x-mock-clerk-id', 'clerk_test_user_99')
      .send({
        name: 'Luna AI',
        description: 'Una guida astronomica per esplorare le stelle ed i pianeti.',
        personality: 'Curiosa, affascinante e appassionata di astrofisica e universo.',
        avatar: 'https://example.com/luna.jpg',
        category: 'fantasy',
        isPublic: true
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('name', 'Luna AI');

    // Il systemPrompt viene generato e salvato, ma non esce MAI dalla API:
    // esporlo permetterebbe di estrarre e clonare le istruzioni di qualunque
    // personaggio (vedi S0-5 nel piano QA).
    expect(res.body.systemPrompt).toBeUndefined();

    const stored = await Character.findById(res.body._id).select('+systemPrompt');
    expect(stored.systemPrompt).toContain('Luna AI');
  });

  it('should export GDPR user data structure on GET /api/users/me/export', async () => {
    const res = await request(app)
      .get('/api/users/me/export')
      .set('x-mock-clerk-id', 'clerk_test_user_99');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('userProfile');
    expect(res.body).toHaveProperty('charactersCreated');
    expect(Array.isArray(res.body.charactersCreated)).toBe(true);
  });

  it('should execute GDPR right to be forgotten on DELETE /api/users/me', async () => {
    // First ensure user exists
    await request(app)
      .get('/api/users/me')
      .set('x-mock-clerk-id', 'clerk_test_user_99');

    const res = await request(app)
      .delete('/api/users/me')
      .set('x-mock-clerk-id', 'clerk_test_user_99');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);

    // Verify user is deleted from DB
    const deletedUser = await User.findOne({ clerkId: 'clerk_test_user_99' });
    expect(deletedUser).toBeNull();
  });
});
