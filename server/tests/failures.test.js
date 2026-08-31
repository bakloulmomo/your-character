/**
 * Che cosa succede quando qualcosa va storto.
 *
 * È il percorso meno esercitato di tutta l'applicazione e quello che deve
 * funzionare meglio: se il modo in cui l'API racconta un guasto è a sua volta
 * guasto, il sintomo che arriva all'utente non ha alcun rapporto con la causa.
 *
 * Tre difetti verificati qui, tutti scoperti misurando invece che leggendo:
 *
 *  1. una rotta API inesistente rispondeva con la pagina HTML di Express
 *     («Cannot GET /api/...», `content-type: text/html`). Un client che chiama
 *     una API JSON e riceve markup non ha modo di leggere l'errore;
 *
 *  2. il gestore globale rispondeva `{ error: { message, status, requestId } }`
 *     — un OGGETTO — mentre le altre 174 risposte di errore usano una stringa.
 *     Il client legge `data.error` e lo passa dentro il JSX: con un oggetto
 *     React solleva «Objects are not valid as a React child» e l'intera pagina
 *     viene sostituita dalla schermata di emergenza. Un errore del server
 *     faceva crollare l'interfaccia invece di produrre un avviso;
 *
 *  3. `reportError` era invocato in un solo punto — proprio quel gestore
 *     globale — ma ogni rotta cattura i propri errori e rispondeva da sé.
 *     Risultato: nessun guasto reale raggiungeva la raccolta errori.
 */
const request = require('supertest');
const express = require('express');
const app = require('../server');
const { serverFailure, warnFailure, logFailure } = require('../services/failure');

describe('come l\'API racconta un guasto', () => {
  describe('rotta inesistente', () => {
    it('risponde in JSON, non con la pagina HTML di Express', async () => {
      const res = await request(app).get('/api/questa-rotta-non-esiste');

      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(typeof res.body.error).toBe('string');
      expect(res.body.error).toContain('/api/questa-rotta-non-esiste');
    });

    it('include il requestId, così la segnalazione si aggancia al log', async () => {
      const res = await request(app).get('/api/nulla');
      expect(res.body.requestId).toEqual(expect.any(String));
      expect(res.headers['x-request-id']).toBe(res.body.requestId);
    });

    it('vale per qualunque metodo, non solo GET', async () => {
      const res = await request(app).post('/api/nulla').send({});
      expect(res.status).toBe(404);
      expect(typeof res.body.error).toBe('string');
    });
  });

  describe('gestore globale degli errori', () => {
    /** Monta il gestore reale in coda a un'app minima che sa esplodere. */
    const appWithBoom = () => {
      const probe = express();
      probe.get('/boom', () => { throw new Error('dettaglio interno da non divulgare'); });
      probe.get('/richiesta-sbagliata', (req, res, next) => {
        next(Object.assign(new Error('Manca il campo obbligatorio'), { status: 400 }));
      });
      // Lo stesso gestore montato da server.js: quattro argomenti, ultimo in coda.
      const handler = app._router.stack.filter((l) => l.handle && l.handle.length === 4).pop().handle;
      probe.use(handler);
      return probe;
    };

    it('`error` è una STRINGA, come in tutte le altre risposte della API', async () => {
      const res = await request(appWithBoom()).get('/boom');

      expect(res.status).toBe(500);
      expect(typeof res.body.error).toBe('string');
      // Non un oggetto: è la forma che faceva crollare il render del client.
      expect(res.body.error).not.toEqual(expect.any(Object));
    });

    it('un 500 non divulga il messaggio interno', async () => {
      const res = await request(appWithBoom()).get('/boom');
      expect(res.body.error).toBe('Errore interno del server');
      expect(JSON.stringify(res.body)).not.toContain('dettaglio interno');
    });

    it('un 4xx conserva invece il proprio messaggio: descrive che cosa correggere', async () => {
      const res = await request(appWithBoom()).get('/richiesta-sbagliata');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Manca il campo obbligatorio');
    });
  });

  describe('serverFailure', () => {
    const fakeReq = (over = {}) => ({
      originalUrl: '/api/prova',
      id: 'req-prova',
      log: { error: jest.fn(), warn: jest.fn() },
      ...over
    });
    const fakeRes = () => {
      const res = { headersSent: false, statusCode: null, body: null };
      res.status = (s) => { res.statusCode = s; return res; };
      res.json = (b) => { res.body = b; return res; };
      return res;
    };

    it('registra sul logger della richiesta, non su console', () => {
      const req = fakeReq();
      const res = fakeRes();

      serverFailure(req, res, new Error('kaboom'), 'Operazione non riuscita');

      expect(req.log.error).toHaveBeenCalledTimes(1);
      const [payload, message] = req.log.error.mock.calls[0];
      expect(message).toBe('Operazione non riuscita');
      expect(payload.err.message).toBe('kaboom');
      expect(payload.route).toBe('/api/prova');
    });

    it('risponde con la stessa forma delle altre rotte', () => {
      const res = fakeRes();
      serverFailure(fakeReq(), res, new Error('kaboom'), 'Operazione non riuscita');

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'Operazione non riuscita', requestId: 'req-prova' });
    });

    it('non prova a rispondere se le intestazioni sono già partite', () => {
      /**
       * Sulla rotta di streaming la risposta comincia con il primo pezzo di
       * testo. Un guasto a metà trasmissione trovava le intestazioni già
       * inviate e `res.status().json()` sollevava a sua volta
       * ERR_HTTP_HEADERS_SENT: un secondo errore, non gestito, sopra il primo.
       */
      const res = fakeRes();
      res.headersSent = true;

      expect(() => serverFailure(fakeReq(), res, new Error('a metà'), 'Interrotto')).not.toThrow();
      expect(res.statusCode).toBeNull();
    });

    it('accetta anche un valore che non è un Error', () => {
      const req = fakeReq();
      serverFailure(req, fakeRes(), 'una stringa lanciata a caso', 'Operazione non riuscita');
      expect(req.log.error.mock.calls[0][0].err.message).toBe('una stringa lanciata a caso');
    });

    it('warnFailure registra senza rispondere', () => {
      const req = fakeReq();
      warnFailure(req, new Error('rimborso fallito'), 'Rimborso non riuscito');
      expect(req.log.warn).toHaveBeenCalledTimes(1);
      expect(req.log.warn.mock.calls[0][1]).toBe('Rimborso non riuscito');
    });

    it('logFailure registra senza rispondere', () => {
      const req = fakeReq();
      logFailure(req, new Error('streaming interrotto'), 'Guasto in streaming');
      expect(req.log.error).toHaveBeenCalledTimes(1);
      expect(req.log.error.mock.calls[0][1]).toBe('Guasto in streaming');
    });
  });

  describe('le rotte non registrano più su console', () => {
    it('nessun file di rotta, servizio o middleware chiama console.*', () => {
      /**
       * Un controllo strutturale, non di comportamento: `console.error` non
       * fallisce mai, quindi nessun test funzionale può accorgersi che una
       * riga di log è stata scritta nel posto sbagliato. Prima erano 59, e con
       * loro spariva l'identificativo di richiesta e la raccolta errori.
       */
      const { readdirSync, readFileSync, statSync } = require('fs');
      const { join, extname } = require('path');
      const root = join(__dirname, '..');

      const walk = (dir) =>
        readdirSync(dir).flatMap((entry) => {
          const full = join(dir, entry);
          return statSync(full).isDirectory() ? walk(full) : [full];
        });

      const files = ['routes', 'services', 'middleware', 'models', 'utils', 'config']
        .flatMap((d) => walk(join(root, d)))
        .filter((f) => extname(f) === '.js')
        // `logger.js` e `failure.js` PARLANO di console nei propri commenti.
        .filter((f) => !/services\/(logger|failure)\.js$/.test(f));

      const offenders = files.filter((f) =>
        /(^|[^.\w])console\s*\.\s*(log|warn|error|info|debug)\s*\(/.test(readFileSync(f, 'utf8'))
      );

      expect(offenders.map((f) => f.replace(root + '/', ''))).toEqual([]);
    });
  });
});
