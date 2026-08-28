const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');

let mongoServer;

describe('Native Authentication Integration Tests', () => {
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
    await User.deleteMany({});
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully with valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'mario.rossi@example.com',
          username: 'mariorossi',
          password: 'Password123!',
          birthdate: '1990-01-01'
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user).toHaveProperty('email', 'mario.rossi@example.com');
      expect(res.body.user).toHaveProperty('username', 'mariorossi');
      expect(res.body.user).toHaveProperty('credits', 10);
      expect(res.body.user).not.toHaveProperty('passwordHash');

      const dbUser = await User.findOne({ email: 'mario.rossi@example.com' });
      expect(dbUser).not.toBeNull();
      expect(dbUser.authProvider).toBe('local');
    });

    it('should reject registration if password lacks complexity', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          username: 'testuser',
          password: 'simplepassword', // No capital letter or number
          birthdate: '1990-01-01'
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should reject registration for users under 18 (A8)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'minor@example.com',
          username: 'minoruser',
          password: 'Password123!',
          birthdate: '2015-01-01' // under 18
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('18 anni');
    });

    it('should reject registration when birthdate is missing (A8)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'nobirth@example.com',
          username: 'nobirthuser',
          password: 'Password123!'
        });

      expect(res.status).toBe(400);
    });

    it('should reject registration if email is already taken', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'duplicate@example.com',
          username: 'user1',
          password: 'Password123!',
          birthdate: '1990-01-01'
        });

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'duplicate@example.com',
          username: 'user2',
          password: 'Password123!',
          birthdate: '1990-01-01'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('già registrato');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'login.user@example.com',
          username: 'loginuser',
          password: 'Password123!',
          birthdate: '1990-01-01'
        });
    });

    it('should login successfully with correct credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'login.user@example.com',
          password: 'Password123!',
          birthdate: '1990-01-01'
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user).toHaveProperty('username', 'loginuser');
    });

    it('should return 401 generic error on wrong password to prevent account enumeration', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'login.user@example.com',
          password: 'WrongPassword123!'
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Credenziali non valide');
    });

    it('should return 401 generic error on non-existent email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'Password123!',
          birthdate: '1990-01-01'
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Credenziali non valide');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should fetch user profile using Bearer JWT token', async () => {
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'jwt.user@example.com',
          username: 'jwtuser',
          password: 'Password123!',
          birthdate: '1990-01-01'
        });

      const token = regRes.body.token;

      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.user).toHaveProperty('username', 'jwtuser');
      expect(meRes.body.user).toHaveProperty('email', 'jwt.user@example.com');
    });

    it('should return 401 Unauthorized without token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should respond successfully on logout', async () => {
      const res = await request(app).post('/api/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });
  });
});
