import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Application root element is missing.');
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerSW({
  immediate: true,
  onRegisterError(error) {
    console.error('Service worker registration failed.', error);
  },
});
