import { defineConfig, devices } from '@playwright/test';

/**
 * Test end-to-end (FASE E — punto 3).
 *
 * Guidano un browser vero contro l'applicazione vera: client, API e database.
 * È l'unico livello che può dire «il prodotto funziona» invece di «le sue parti
 * rispondono correttamente prese una alla volta» — la distinzione che l'audit
 * iniziale aveva trovato disattesa ovunque.
 *
 * L'ambiente si avvia da solo: `e2eStack.js` porta su un MongoDB in memoria e
 * l'API sulla 5051, e Vite serve il client sulla 5174 puntando lì. Nessun
 * database di sistema, nessun dato reale toccato, nessun passaggio manuale.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // Un test E2E che passa solo al secondo tentativo sta nascondendo qualcosa.
  // In CI si concede un solo nuovo tentativo per i guasti di rete, in locale zero.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: 'node ../server/scripts/e2eStack.js',
      url: 'http://127.0.0.1:5051/health',
      reuseExistingServer: !process.env.CI,
      // Al primo avvio `mongodb-memory-server` può dover scaricare il binario.
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { E2E_API_PORT: '5051' }
    },
    {
      // `--host 127.0.0.1` è necessario: senza, Vite ascolta su ::1 e il
      // controllo di Playwright su 127.0.0.1 non lo trova, quindi prova ad
      // avviarne un secondo e fallisce per porta occupata.
      command: 'vite --port 5174 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { VITE_API_TARGET: 'http://127.0.0.1:5051' }
    }
  ]
});
