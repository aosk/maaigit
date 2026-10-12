import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  Alert,
  EngineSettings,
  HistoryPoint,
  Instrument,
  Order,
  PortfolioSnapshot,
  TypeControls,
} from '../../../shared/src/types.js';
import { api } from './api.js';

const MAX_CLIENT_HISTORY = 480;

export type ConnectionState = 'connecting' | 'live' | 'down';

interface StoreValue {
  ready: boolean;
  connection: ConnectionState;
  loadError: string | null;
  portfolio: PortfolioSnapshot | null;
  instruments: Instrument[];
  history: HistoryPoint[];
  controls: TypeControls[];
  engine: EngineSettings | null;
  alerts: Alert[];
  orders: Order[];
  /** Re-reads everything the control page can change. */
  refresh: () => Promise<void>;
  setControls: (next: TypeControls) => void;
  setEngine: (next: EngineSettings) => void;
  setAlerts: (next: Alert[]) => void;
  setInstruments: (next: Instrument[]) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [controls, setControlsList] = useState<TypeControls[]>([]);
  const [engine, setEngineState] = useState<EngineSettings | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [snap, hist, book, ctrl, eng, alertRows, orderRows] = await Promise.all([
        api.portfolio(),
        api.history(MAX_CLIENT_HISTORY),
        api.instruments(),
        api.controls(),
        api.engine(),
        api.alerts(),
        api.orders(25),
      ]);
      setPortfolio(snap);
      setHistory(hist);
      setInstruments(book);
      setControlsList(ctrl);
      setEngineState(eng);
      setAlerts(alertRows);
      setOrders(orderRows);
      setLoadError(null);
      setReady(true);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The live stream. EventSource reconnects on its own; we only mirror the
  // connection state so the header can say whether the numbers are moving.
  useEffect(() => {
    const source = new EventSource('/api/stream');

    source.addEventListener('open', () => setConnection('live'));
    source.addEventListener('error', () => setConnection('down'));

    source.addEventListener('tick', (event) => {
      setConnection('live');
      const data = JSON.parse((event as MessageEvent).data) as {
        portfolio: PortfolioSnapshot;
        instruments?: Instrument[];
        history?: HistoryPoint[];
        engine?: EngineSettings;
      };
      setPortfolio(data.portfolio);
      if (data.instruments) setInstruments(data.instruments);
      if (data.engine) setEngineState(data.engine);
      if (data.history?.length) {
        setHistory((prev) => {
          const next = [...prev, ...data.history!];
          return next.length > MAX_CLIENT_HISTORY
            ? next.slice(next.length - MAX_CLIENT_HISTORY)
            : next;
        });
      }
    });

    source.addEventListener('alerts', (event) => {
      const { raised } = JSON.parse((event as MessageEvent).data) as { raised: Alert[] };
      setAlerts((prev) => [...raised, ...prev].slice(0, 100));
    });

    source.addEventListener('settings', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as {
        controls?: TypeControls[];
        engine?: EngineSettings;
      };
      if (data.controls) setControlsList(data.controls);
      if (data.engine) setEngineState(data.engine);
    });

    source.addEventListener('book', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { instruments: Instrument[] };
      setInstruments(data.instruments);
    });

    return () => source.close();
  }, []);

  const setControls = useCallback((next: TypeControls) => {
    setControlsList((prev) => prev.map((row) => (row.type === next.type ? next : row)));
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      connection,
      loadError,
      portfolio,
      instruments,
      history,
      controls,
      engine,
      alerts,
      orders,
      refresh,
      setControls,
      setEngine: setEngineState,
      setAlerts,
      setInstruments,
    }),
    [
      ready,
      connection,
      loadError,
      portfolio,
      instruments,
      history,
      controls,
      engine,
      alerts,
      orders,
      refresh,
      setControls,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside <StoreProvider>.');
  return value;
}

/**
 * Measures a container so charts lay out against a real pixel width instead of
 * guessing, and re-render when the card is resized.
 *
 * This hands back a *callback ref* rather than a ref object on purpose. A chart
 * that early-returns an empty state while its data loads mounts its real
 * container only on a later render; a ref object read inside a mount effect is
 * still null at that point and the observer would never attach, leaving the
 * chart stuck at zero width. A callback ref fires whenever the node appears.
 */
export function useElementWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!node) return;

    // A container can momentarily measure 0 while the page is re-laid out (a
    // full-page screenshot, a hidden tab, a tab switch). Holding the last real
    // width keeps the chart on screen instead of blanking it.
    const apply = (next: number) => {
      setWidth((prev) => {
        if (next <= 0) return prev;
        return Math.abs(prev - next) > 0.5 ? next : prev;
      });
    };

    const observer = new ResizeObserver((entries) => {
      apply(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(node);
    apply(node.getBoundingClientRect().width || node.clientWidth);
    return () => observer.disconnect();
  }, [node]);

  return [setNode, width];
}

/** Remembers the viewer's theme choice; defaults to the OS setting. */
export function useTheme(): ['light' | 'dark' | 'system', (next: 'light' | 'dark' | 'system') => void] {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() => {
    try {
      const saved = localStorage.getItem('stockplay:theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      /* private mode or blocked storage — fall through to the OS setting */
    }
    return 'system';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      if (theme === 'system') localStorage.removeItem('stockplay:theme');
      else localStorage.setItem('stockplay:theme', theme);
    } catch {
      /* not persisting the choice is survivable */
    }
  }, [theme]);

  return [theme, setTheme];
}
