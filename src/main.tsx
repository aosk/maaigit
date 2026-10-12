import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SettingsProvider } from './settings';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  // No StrictMode: in development it runs effects twice, which would send every AI request twice.
  <SettingsProvider>
    <App />
  </SettingsProvider>,
);
