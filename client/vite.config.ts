/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // I test end-to-end fanno partire una loro API su un'altra porta, con
        // un database in memoria: senza questa variabile punterebbero al server
        // di sviluppo e girerebbero contro i dati reali di chi sta lavorando.
        target: process.env.VITE_API_TARGET || 'http://localhost:5001',
        changeOrigin: true
      }
    }
  },
  /**
   * Test dell'interfaccia (FASE E — punto 2).
   *
   * Fino a qui il frontend non aveva alcun test: 202 test verdi sul server
   * convivevano con un'interfaccia in cui un pulsante scollegato o una pagina
   * che non renderizza non avrebbero fatto fallire nulla. È la stessa forma del
   * difetto originale — «la suite non copre nessuna delle superfici rotte» —
   * spostata di un livello.
   */
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Gli E2E Playwright vivono in `e2e/` e hanno un loro runner: se Vitest li
    // raccogliesse, fallirebbero per il motivo sbagliato.
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
    css: false,
    restoreMocks: true
  }
});
