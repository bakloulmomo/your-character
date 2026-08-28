/**
 * Limite generale su tutta la API.
 *
 * I limitatori esistenti coprivano solo le rotte che costano una chiamata al
 * modello. Le rotte di sola lettura — galleria, elenco chat, /auth/me — non ne
 * avevano alcuno: un client poteva interrogarle in ciclo indefinitamente.
 *
 * Nota sull'impostazione: le variabili vanno definite PRIMA dei require, non
 * dentro `beforeAll`. I limitatori leggono la soglia al momento in cui il
 * modulo viene caricato, e Jest da' a ogni file di test un registro dei moduli
 * separato — quindi qui basta l'ordine. Il tentativo di usare
 * `jest.resetModules()` dentro `beforeAll` creava invece una seconda istanza
 * dell'applicazione con un `mongoose` diverso da quello connesso, e ogni query
 * restava appesa fino al timeout.
 */
process.env.FORCE_RATE_LIMIT = '1';
process.env.GLOBAL_RATE_MAX = '5';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');

let mongoServer;

describe('Limite generale della API', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    delete process.env.FORCE_RATE_LIMIT;
    delete process.env.GLOBAL_RATE_MAX;
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }, 30000);

  it('oltre la soglia una rotta di sola lettura viene rifiutata con 429', async () => {
    const esiti = [];
    for (let i = 0; i < 9; i++) {
      esiti.push((await request(app).get('/api/characters')).status);
    }
    expect(esiti.filter((s) => s === 200).length).toBe(5);
    expect(esiti.filter((s) => s === 429).length).toBe(4);
  }, 20000);

  it('il controllo di salute resta fuori dal limite: serve al deploy per sapere se il servizio e vivo', async () => {
    for (let i = 0; i < 12; i++) {
      expect((await request(app).get('/health')).status).toBe(200);
    }
  }, 20000);
});
