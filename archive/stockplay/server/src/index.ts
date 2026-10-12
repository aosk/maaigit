import { EventBus } from './bus.js';
import { createApp } from './app.js';
import { evaluateAlerts } from './engine/alerts.js';
import { recordHistory, tick } from './engine/market.js';
import { historyPoint, snapshot } from './engine/portfolio.js';
import { loadState, saveState, DATA_FILE_PATH } from './store/state.js';

const PORT = Number(process.env.PORT ?? 4000);

const state = loadState();
const bus = new EventBus();

let saveTimer: NodeJS.Timeout | null = null;
/** State is written at most once a second; ticks are frequent and the file is
 *  only a convenience, not the source of truth for a live session. */
function persist(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveState(state);
  }, 1000);
  saveTimer.unref?.();
}

let loopTimer: NodeJS.Timeout | null = null;

function runTick(): void {
  if (!state.engine.running) return;

  tick(state);
  const snap = snapshot(state);
  recordHistory(state, historyPoint(state));
  const raised = evaluateAlerts(state, snap);

  bus.emit({
    kind: 'tick',
    payload: {
      portfolio: snap,
      instruments: state.instruments,
      history: state.history.slice(-1),
      engine: state.engine,
    },
  });
  if (raised.length) bus.emit({ kind: 'alerts', payload: { raised } });
  persist();
}

function scheduleLoop(): void {
  if (loopTimer) clearInterval(loopTimer);
  loopTimer = setInterval(runTick, state.engine.tickIntervalMs);
}

// Give the dashboard a curve to draw on a cold start instead of one lonely point.
if (state.history.length === 0) {
  const wasRunning = state.engine.running;
  state.engine.running = true;
  for (let i = 0; i < 180; i += 1) {
    tick(state);
    recordHistory(state, historyPoint(state));
  }
  state.engine.running = wasRunning;
  state.alerts = [];
}

const app = createApp({ state, bus, persist, onEngineChange: scheduleLoop });

const server = app.listen(PORT, () => {
  console.log(`[stockplay] api on http://localhost:${PORT}`);
  console.log(`[stockplay] state file ${DATA_FILE_PATH}`);
  scheduleLoop();
});

function shutdown(signal: string): void {
  console.log(`[stockplay] ${signal} — shutting down`);
  if (loopTimer) clearInterval(loopTimer);
  saveState(state);
  bus.closeAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
