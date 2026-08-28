import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { initMonitoring } from './lib/monitoring';
import './index.css';

// Prima di montare l'albero: un errore durante il primo render deve poter
// essere raccolto quanto uno successivo.
initMonitoring();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
