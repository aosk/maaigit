import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AssetType,
  EngineSettings,
  Instrument,
  OrderSide,
  TypeControls,
} from '../../../shared/src/types.js';
import { AlertList } from '../components/AlertList.js';
import { FilterRow } from '../components/FilterRow.js';
import { Banner, Card, Delta, SliderField, Switch, TypeBadge } from '../components/ui.js';
import { ASSET_TYPES, typeBlurb, typeColor, typeLabel } from '../lib/assetTypes.js';
import { api, ApiError, type NewInstrument } from '../lib/api.js';
import { clockTime, money, moneyCents, percent, shares } from '../lib/format.js';
import { useStore } from '../lib/store.js';
import { useTypeFilter } from '../lib/useTypeFilter.js';

const PATCH_DEBOUNCE_MS = 350;

export function ControlPage() {
  const store = useStore();
  const { selected, toggle, selectAll } = useTypeFilter();
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const say = useCallback((tone: 'ok' | 'error', text: string) => {
    setNotice({ tone, text });
  }, []);

  if (store.loadError && !store.ready) {
    return (
      <Banner tone="error">
        {store.loadError} Start the API with <code>npm run dev:server</code> and reload.
      </Banner>
    );
  }
  if (!store.portfolio || !store.engine) return <div className="empty">Loading controls…</div>;

  const visibleTypes = ASSET_TYPES.filter((type) => selected.has(type));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Controls</h1>
          <p>
            Trade, set per-type risk limits, manage the instrument book and drive the market
            simulation. Limits here are enforced by the API, not just the form.
          </p>
        </div>
      </div>

      <FilterRow selected={selected} onToggle={toggle} onSelectAll={selectAll} />

      {notice ? (
        <Banner tone={notice.tone} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Banner>
      ) : null}

      <div className="grid grid-halves" style={{ marginBottom: 16 }}>
        <TradeTicket types={selected} onResult={say} />
        <SimulationCard engine={store.engine} onResult={say} />
      </div>

      <h2 style={{ fontSize: 15, margin: '4px 0 12px' }}>Per-type limits</h2>
      {visibleTypes.length === 0 ? (
        <Banner tone="info">No stock types selected. Pick at least one in the filter row.</Banner>
      ) : (
        <div className="grid grid-controls" style={{ marginBottom: 16 }}>
          {visibleTypes.map((type) => (
            <TypeControlCard key={type} type={type} onResult={say} />
          ))}
        </div>
      )}

      <div className="grid grid-main" style={{ marginBottom: 16 }}>
        <InstrumentBook types={selected} onResult={say} />
        <div className="grid" style={{ gap: 16 }}>
          <AlertsCard />
          <OrdersCard />
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ trade */

function TradeTicket({
  types,
  onResult,
}: {
  types: Set<AssetType>;
  onResult: (tone: 'ok' | 'error', text: string) => void;
}) {
  const { instruments, portfolio, controls } = useStore();
  const [instrumentId, setInstrumentId] = useState('');
  const [side, setSide] = useState<OrderSide>('BUY');
  const [quantity, setQuantity] = useState('10');
  const [busy, setBusy] = useState(false);

  const tradable = useMemo(
    () => instruments.filter((i) => i.active && types.has(i.type)),
    [instruments, types],
  );

  useEffect(() => {
    if (tradable.length === 0) setInstrumentId('');
    else if (!tradable.some((i) => i.id === instrumentId)) setInstrumentId(tradable[0].id);
  }, [tradable, instrumentId]);

  const instrument = tradable.find((i) => i.id === instrumentId) ?? null;
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  const notional = instrument ? qty * instrument.price : 0;
  const held = portfolio?.holdings.find((h) => h.instrumentId === instrumentId)?.quantity ?? 0;
  const typeControls = instrument ? controls.find((c) => c.type === instrument.type) : null;
  const cashAfter = (portfolio?.cash ?? 0) + (side === 'BUY' ? -notional : notional);

  const disabledReason = !instrument
    ? 'No tradable instrument in the selected stock types.'
    : typeControls && !typeControls.tradingEnabled
      ? `Trading is off for ${typeLabel(instrument.type).toLowerCase()}.`
      : qty <= 0
        ? 'Enter a whole number of shares.'
        : side === 'BUY' && notional > (portfolio?.cash ?? 0)
          ? `Needs ${money(notional)}; cash is ${money(portfolio?.cash ?? 0)}.`
          : side === 'SELL' && qty > held
            ? `Position holds ${shares(held)} shares.`
            : null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!instrument || disabledReason) return;
    setBusy(true);
    try {
      const { order } = await api.placeOrder({ instrumentId: instrument.id, side, quantity: qty });
      onResult(
        'ok',
        `${order.side === 'BUY' ? 'Bought' : 'Sold'} ${shares(order.quantity)} ${order.symbol} at ${moneyCents(order.price)} — ${money(order.notional)}.`,
      );
    } catch (err) {
      onResult('error', err instanceof ApiError ? err.message : 'Order failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Trade ticket" subtitle="Market orders fill at the current simulated price.">
      <form className="stack" onSubmit={submit} style={{ marginTop: 10 }}>
        <div className="field">
          <label htmlFor="ticket-instrument">Instrument</label>
          <select
            id="ticket-instrument"
            value={instrumentId}
            onChange={(e) => setInstrumentId(e.target.value)}
            disabled={tradable.length === 0}
          >
            {tradable.length === 0 ? <option value="">No instruments in this filter</option> : null}
            {tradable.map((i) => (
              <option key={i.id} value={i.id}>
                {i.symbol} — {i.name} ({typeLabel(i.type)})
              </option>
            ))}
          </select>
        </div>

        <div className="row">
          <div className="field">
            <span className="field-label" id="side-label">
              Side
            </span>
            <div
              className="segmented"
              role="group"
              aria-labelledby="side-label"
              style={{ alignSelf: 'flex-start' }}
            >
              <button type="button" aria-pressed={side === 'BUY'} onClick={() => setSide('BUY')}>
                Buy
              </button>
              <button type="button" aria-pressed={side === 'SELL'} onClick={() => setSide('SELL')}>
                Sell
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="ticket-qty">Shares</label>
            <input
              id="ticket-qty"
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
        </div>

        <dl className="kv-list">
          <div className="kv">
            <dt>Price</dt>
            <dd>{instrument ? moneyCents(instrument.price) : '—'}</dd>
          </div>
          <div className="kv">
            <dt>Order value</dt>
            <dd>{money(notional)}</dd>
          </div>
          <div className="kv">
            <dt>Position now</dt>
            <dd>{shares(held)} shares</dd>
          </div>
          <div className="kv">
            <dt>Cash after</dt>
            <dd>{money(cashAfter)}</dd>
          </div>
        </dl>

        {disabledReason ? <p className="field-hint">{disabledReason}</p> : null}

        <button type="submit" className="btn btn-primary" disabled={busy || !!disabledReason}>
          {busy ? 'Working…' : `${side === 'BUY' ? 'Buy' : 'Sell'} ${shares(qty)} shares`}
        </button>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------- simulation */

function SimulationCard({
  engine,
  onResult,
}: {
  engine: EngineSettings;
  onResult: (tone: 'ok' | 'error', text: string) => void;
}) {
  const { setEngine } = useStore();
  const [draft, setDraft] = useState(engine);
  const timer = useRef<number | null>(null);

  useEffect(() => setDraft(engine), [engine]);

  const push = (patch: Partial<EngineSettings>, immediate = false) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (timer.current) window.clearTimeout(timer.current);
    const send = async () => {
      try {
        setEngine(await api.updateEngine(patch));
      } catch (err) {
        onResult('error', err instanceof ApiError ? err.message : 'Could not update the engine.');
      }
    };
    if (immediate) void send();
    else timer.current = window.setTimeout(send, PATCH_DEBOUNCE_MS);
  };

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const sentimentWord =
    draft.marketSentiment > 0.15 ? 'bullish' : draft.marketSentiment < -0.15 ? 'bearish' : 'neutral';

  return (
    <Card
      title="Market simulation"
      subtitle="Drives every price in the book. Types respond differently to the same settings."
      actions={
        <Switch
          checked={draft.running}
          onChange={(running) => push({ running }, true)}
          onLabel="Running"
          offLabel="Paused"
        />
      }
    >
      <div className="stack" style={{ marginTop: 12 }}>
        <SliderField
          label="Simulated minutes per tick"
          value={draft.minutesPerTick}
          display={`${draft.minutesPerTick} min`}
          min={1}
          max={60}
          step={1}
          onChange={(minutesPerTick) => push({ minutesPerTick })}
          hint="A session is 390 simulated minutes. Mutual funds reprice once per session."
        />
        <SliderField
          label="Tick interval"
          value={draft.tickIntervalMs}
          display={`${(draft.tickIntervalMs / 1000).toFixed(1)}s`}
          min={500}
          max={10000}
          step={250}
          onChange={(tickIntervalMs) => push({ tickIntervalMs })}
          hint="Wall-clock time between ticks."
        />
        <SliderField
          label="Market volatility"
          value={draft.marketVolatility}
          display={`${draft.marketVolatility.toFixed(2)}×`}
          min={0}
          max={3}
          step={0.05}
          onChange={(marketVolatility) => push({ marketVolatility })}
          hint="Multiplies every type's own volatility on top of its per-type factor."
        />
        <SliderField
          label="Market sentiment"
          value={draft.marketSentiment}
          display={sentimentWord}
          min={-1}
          max={1}
          step={0.05}
          onChange={(marketSentiment) => push({ marketSentiment })}
          hint="Shifts the drift of every instrument, bearish through bullish."
        />
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------- type limits */

function TypeControlCard({
  type,
  onResult,
}: {
  type: AssetType;
  onResult: (tone: 'ok' | 'error', text: string) => void;
}) {
  const { controls, portfolio, setControls } = useStore();
  const server = controls.find((row) => row.type === type);
  const [draft, setDraft] = useState<TypeControls | null>(server ?? null);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);

  // Adopt server values unless the viewer is mid-edit on this card.
  useEffect(() => {
    if (server && !dirty.current) setDraft(server);
  }, [server]);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  if (!draft) return null;

  const summary = portfolio?.byType.find((row) => row.type === type);

  const push = (patch: Partial<TypeControls>, immediate = false) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    dirty.current = true;
    if (timer.current) window.clearTimeout(timer.current);
    const send = async () => {
      try {
        setControls(await api.updateControls(type, patch));
      } catch (err) {
        onResult('error', err instanceof ApiError ? err.message : 'Could not save the limit.');
      } finally {
        dirty.current = false;
      }
    };
    if (immediate) void send();
    else timer.current = window.setTimeout(send, PATCH_DEBOUNCE_MS);
  };

  return (
    <section className="card">
      <div className="type-card-head">
        <span className="type-rail" style={{ background: typeColor(type) }} aria-hidden="true" />
        <h3>{typeLabel(type)}</h3>
        <Switch
          checked={draft.tradingEnabled}
          onChange={(tradingEnabled) => push({ tradingEnabled }, true)}
          onLabel="Trading on"
          offLabel="Trading off"
        />
      </div>

      <p className="card-sub" style={{ marginBottom: 12 }}>
        {typeBlurb(type)}
      </p>

      {summary ? (
        <dl className="kv-list" style={{ marginBottom: 12 }}>
          <div className="kv">
            <dt>Held</dt>
            <dd>
              {money(summary.marketValue)} · {percent(summary.weight)}
            </dd>
          </div>
          <div className="kv">
            <dt>Day</dt>
            <dd>
              <Delta value={summary.dayChangePct} asPercent />
            </dd>
          </div>
          <div className="kv">
            <dt>Positions</dt>
            <dd>{summary.positions}</dd>
          </div>
        </dl>
      ) : null}

      <div className="stack" style={{ gap: 12 }}>
        <SliderField
          label="Target allocation"
          value={draft.targetAllocation}
          display={percent(draft.targetAllocation, 0)}
          min={0}
          max={1}
          step={0.01}
          onChange={(targetAllocation) => push({ targetAllocation })}
        />
        <SliderField
          label="Max single position"
          value={draft.maxPositionPct}
          display={percent(draft.maxPositionPct, 0)}
          min={0.01}
          max={1}
          step={0.01}
          onChange={(maxPositionPct) => push({ maxPositionPct })}
          hint="Buys that would breach this are rejected by the API."
        />
        <SliderField
          label="Day-move alert"
          value={draft.moveAlertPct}
          display={percent(draft.moveAlertPct, 1)}
          min={0}
          max={0.25}
          step={0.005}
          onChange={(moveAlertPct) => push({ moveAlertPct })}
        />
        <SliderField
          label="Stop-loss alert"
          value={draft.stopLossPct}
          display={draft.stopLossPct === 0 ? 'off' : percent(draft.stopLossPct, 0)}
          min={0}
          max={0.6}
          step={0.01}
          onChange={(stopLossPct) => push({ stopLossPct })}
        />
        <SliderField
          label="Volatility factor"
          value={draft.volatilityFactor}
          display={`${draft.volatilityFactor.toFixed(2)}×`}
          min={0.1}
          max={3}
          step={0.05}
          onChange={(volatilityFactor) => push({ volatilityFactor })}
          hint="Scales how hard this type moves in the simulation."
        />
      </div>
    </section>
  );
}

/* ------------------------------------------------------- instrument book */

const BLANK: NewInstrument = {
  symbol: '',
  name: '',
  type: 'COMMON',
  exchange: 'NYSE',
  sector: '',
  price: 100,
};

function InstrumentBook({
  types,
  onResult,
}: {
  types: Set<AssetType>;
  onResult: (tone: 'ok' | 'error', text: string) => void;
}) {
  const { instruments, portfolio, setInstruments } = useStore();
  const [form, setForm] = useState<NewInstrument>(BLANK);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () => instruments.filter((i) => types.has(i.type)).sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [instruments, types],
  );

  const heldBy = (id: string) =>
    portfolio?.holdings.find((holding) => holding.instrumentId === id)?.quantity ?? 0;

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await api.addInstrument({ ...form, price: Number(form.price) });
      onResult('ok', `${created.symbol} added to the book as ${typeLabel(created.type)}.`);
      setForm({ ...BLANK, type: form.type });
    } catch (err) {
      onResult('error', err instanceof ApiError ? err.message : 'Could not add the instrument.');
    } finally {
      setBusy(false);
    }
  };

  const change = async (instrument: Instrument, patch: Partial<Instrument>) => {
    try {
      const updated = await api.updateInstrument(instrument.id, patch);
      setInstruments(instruments.map((i) => (i.id === updated.id ? updated : i)));
    } catch (err) {
      onResult('error', err instanceof ApiError ? err.message : 'Could not update the instrument.');
    }
  };

  const remove = async (instrument: Instrument) => {
    try {
      await api.removeInstrument(instrument.id);
      setInstruments(instruments.filter((i) => i.id !== instrument.id));
      onResult('ok', `${instrument.symbol} removed from the book.`);
    } catch (err) {
      onResult('error', err instanceof ApiError ? err.message : 'Could not remove the instrument.');
    }
  };

  return (
    <Card
      title="Instrument book"
      subtitle="Add a stock, reclassify it, suspend it, or drop it once the position is closed."
    >
      <form className="row" onSubmit={add} style={{ margin: '12px 0 16px', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '0 1 110px' }}>
          <label htmlFor="new-symbol">Symbol</label>
          <input
            id="new-symbol"
            type="text"
            required
            maxLength={12}
            placeholder="ACME"
            value={form.symbol}
            onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
          />
        </div>
        <div className="field" style={{ flex: '2 1 170px' }}>
          <label htmlFor="new-name">Name</label>
          <input
            id="new-name"
            type="text"
            required
            placeholder="Acme Corporation"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="field" style={{ flex: '1 1 150px' }}>
          <label htmlFor="new-type">Stock type</label>
          <select
            id="new-type"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as AssetType })}
          >
            {ASSET_TYPES.map((type) => (
              <option key={type} value={type}>
                {typeLabel(type)}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: '0 1 110px' }}>
          <label htmlFor="new-sector">Sector</label>
          <input
            id="new-sector"
            type="text"
            placeholder="Technology"
            value={form.sector}
            onChange={(e) => setForm({ ...form, sector: e.target.value })}
          />
        </div>
        <div className="field" style={{ flex: '0 1 100px' }}>
          <label htmlFor="new-price">Price</label>
          <input
            id="new-price"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={form.price}
            onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Add stock
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="empty">No instruments in the selected stock types.</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col">Type</th>
                <th scope="col">Price</th>
                <th scope="col">Held</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((instrument) => {
                const held = heldBy(instrument.id);
                return (
                  <tr key={instrument.id}>
                    <td>
                      <span className="sym">{instrument.symbol}</span>
                      <br />
                      <span className="sym-name">
                        {instrument.name} · {instrument.exchange}
                      </span>
                    </td>
                    <td style={{ textAlign: 'left' }}>
                      <label className="visually-hidden" htmlFor={`type-${instrument.id}`}>
                        Stock type for {instrument.symbol}
                      </label>
                      <select
                        id={`type-${instrument.id}`}
                        value={instrument.type}
                        onChange={(e) => change(instrument, { type: e.target.value as AssetType })}
                        style={{ width: 'auto', padding: '4px 6px', fontSize: 12.5 }}
                      >
                        {ASSET_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {typeLabel(type)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{moneyCents(instrument.price)}</td>
                    <td>{shares(held)}</td>
                    <td style={{ textAlign: 'left' }}>
                      <Switch
                        checked={instrument.active}
                        onChange={(active) => change(instrument, { active })}
                        onLabel="Active"
                        offLabel="Suspended"
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={held > 0}
                        title={held > 0 ? 'Sell the position before removing it.' : undefined}
                        onClick={() => remove(instrument)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- side cards */

function AlertsCard() {
  const { alerts, setAlerts } = useStore();
  const open = alerts.filter((alert) => !alert.acknowledged);

  const ack = async (id: string) => {
    setAlerts(alerts.map((alert) => (alert.id === id ? { ...alert, acknowledged: true } : alert)));
    try {
      await api.ackAlert(id);
    } catch {
      /* the stream reconciles on the next tick */
    }
  };

  return (
    <Card title="Alerts" subtitle={`${open.length} open across all stock types`}>
      <AlertList alerts={alerts.slice(0, 30)} onAck={ack} emptyMessage="No alerts raised yet." />
    </Card>
  );
}

function OrdersCard() {
  const { orders, portfolio } = useStore();
  const [recent, setRecent] = useState(orders);

  // Orders are not pushed on the stream; re-read them when the book moves.
  useEffect(() => {
    let cancelled = false;
    void api
      .orders(15)
      .then((rows) => {
        if (!cancelled) setRecent(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [portfolio?.realizedPnL, portfolio?.cash]);

  return (
    <Card title="Recent orders" subtitle="Fills from this session">
      {recent.length === 0 ? (
        <div className="empty">No orders yet. Use the trade ticket above.</div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 280, overflowY: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col">Side</th>
                <th scope="col">Qty</th>
                <th scope="col">Price</th>
                <th scope="col">Value</th>
                <th scope="col">At</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((order) => (
                <tr key={order.id}>
                  <td>
                    <span className="sym">{order.symbol}</span>
                    <br />
                    <TypeBadge type={order.type} />
                  </td>
                  <td>{order.side === 'BUY' ? 'Buy' : 'Sell'}</td>
                  <td>{shares(order.quantity)}</td>
                  <td>{moneyCents(order.price)}</td>
                  <td>{money(order.notional)}</td>
                  <td>{clockTime(order.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
