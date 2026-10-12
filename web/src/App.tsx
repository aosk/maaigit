import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { ControlPage } from './pages/ControlPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { StoreProvider, useStore, useTheme } from './lib/store.js';
import { clockTime } from './lib/format.js';

function ConnectionPill() {
  const { connection, engine, portfolio } = useStore();
  const paused = connection === 'live' && engine?.running === false;
  const tone = connection === 'down' ? 'down' : paused ? 'paused' : 'live';
  const label =
    connection === 'down'
      ? 'Stream offline'
      : connection === 'connecting'
        ? 'Connecting…'
        : paused
          ? 'Simulation paused'
          : `Live · ${portfolio ? clockTime(portfolio.asOf) : '--:--'}`;

  return (
    <span className={`conn conn-${tone}`} role="status">
      <span className="conn-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
    </button>
  );
}

function Shell() {
  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l5-6 4 3 4-7 5 4" />
            </svg>
          </span>
          StockPlay
        </span>
        <nav className="nav" aria-label="Primary">
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/controls">Controls</NavLink>
        </nav>
        <div className="header-right">
          <ConnectionPill />
          <ThemeToggle />
        </div>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/controls" element={<ControlPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
