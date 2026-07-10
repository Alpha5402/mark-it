import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installWebBridge } from './webBridge';
import '../desktop/src/styles.css';

installWebBridge();

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
