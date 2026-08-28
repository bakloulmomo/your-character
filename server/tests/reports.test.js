const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');
const Character = require('../models/Character');
const Report = require('../models/Report');

let mongoServer;
let testUser;
let testCharacter;

describe('FASE 6: Abuse Reporting & Safety Integration Tests', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Character.deleteMany({}),
      Report.deleteMany({})
    ]);

    testUser = await User.create({
      clerkId: 'clerk_report_user',
      email: 'reporter@example.com',
      username: 'reporteruser'
    });

    testCharacter = await Character.create({
      name: 'Character Da Segnalare',
      description: 'Descrizione per test segnalazioni.',
      personality: 'Personalita per test segnalazioni.',
      avatar: 'https://example.com/avatar.jpg',
      isPublic: true,
      createdBy: testUser._id
    });
  });

  it('should submit an abuse report successfully (HTTP 201)', async () => {
    const res = await request(app)
      .post('/api/reports')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({
        targetType: 'character',
        targetId: testCharacter._id.toString(),
        reason: 'hate_speech',
        description: 'Questo character viola le regole sulla sicurezza.'
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('reportId');

    const createdReport = await Report.findById(res.body.reportId);
    expect(createdReport).not.toBeNull();
    expect(createdReport.reason).toBe('hate_speech');
    expect(createdReport.status).toBe('pending');
  });

  it('should reject self-reporting of user (HTTP 400)', async () => {
    const res = await request(app)
      .post('/api/reports')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({
        targetType: 'user',
        targetId: testUser._id.toString(),
        reason: 'spam'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Non puoi segnalare te stesso');
  });

  it('should reject invalid report payload with Zod validation (HTTP 400)', async () => {
    const res = await request(app)
      .post('/api/reports')
      .set('x-mock-clerk-id', testUser.clerkId)
      .send({
        targetType: 'invalid_type',
        targetId: 'invalid-id',
        reason: 'not_a_reason'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Dati di input non validi');
  });
});
