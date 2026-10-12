# StockPlay

A portfolio **dashboard** and a **control page** for a book that holds several
different types of stock. The dashboard answers *where does the money sit and
how is it doing*; the control page is where you trade, set the risk limits per
stock type, manage the instrument book and drive the market simulation that
feeds it all.

Everything runs locally against a simulated market — no market-data vendor, no
API keys.

## Stock types

Six types are modelled, each with its own behaviour in the simulation rather
than just a different label:

| Type | Behaves like |
|---|---|
| **Common stock** | Ordinary shares. Medium volatility, small dividend. |
| **Preferred stock** | Bond-like: muted price swings, a large fixed dividend. |
| **ETF** | A diversified basket, so single-name shocks are damped. |
| **REIT** | Rate sensitive, distribution heavy. |
| **ADR** | Foreign issuer listed locally; the widest swings of the six. |
| **Mutual fund** | Prices once per NAV window, not continuously through the day. |

Each type owns one colour slot for its whole life. Filtering a type out of a
view never repaints the ones that remain.

## Running it

```bash
npm install
npm run dev          # API on :4000, dashboard on :5173
```

Open <http://localhost:5173>. The Vite dev server proxies `/api` to the API, so
there is nothing else to configure.

To run the built app from a single origin:

```bash
npm start            # builds web + server, then serves both on :4000
```

Other scripts:

| Script | Does |
|---|---|
| `npm test` | Runs the engine test suite (simulation, portfolio maths, orders, alerts). |
| `npm run typecheck` | Typechecks every workspace. |
| `npm run build` | Builds shared types, the API and the web bundle. |
| `npm run dev:server` / `npm run dev:web` | Runs one half on its own. |

## The dashboard

One filter row scopes the whole page: which stock types to include, and how far
back to look. Every tile, chart and table below re-renders against that same
slice.

- **Stat tiles** — total portfolio, value of the selected types, unrealized
  P/L, and cash including the dividend income credited so far.
- **Value of selected stock types** — the value curve over the window. Hover
  for a crosshair, or focus the chart and use ← → to read any point from the
  keyboard.
- **Mix by stock type** — part-to-whole across at most six segments.
- **Return by stock type** — unrealized return against average cost, on a zero
  baseline.
- **Held against target** — each type's weight with a tick marking the target
  set on the control page, plus a small trend line per type.
- **Holdings** — every position, sortable by any column.
- **Open alerts** — whatever has crossed a threshold, acknowledgeable in place.

Every chart has a **Table** toggle showing the same numbers, so no value is
reachable only by hovering.

## The control page

- **Trade ticket** — market buys and sells at the current simulated price, with
  the order value, the resulting cash and the reason a rejected order would be
  rejected shown before you submit.
- **Market simulation** — run/pause, how much simulated time passes per tick,
  how often a tick fires, a global volatility multiplier and a sentiment bias
  from bearish to bullish.
- **Per-type limits** — one card per stock type: a trading on/off switch,
  target allocation, a cap on any single position, a day-move alert threshold,
  a stop-loss threshold, and a volatility factor that changes how hard that
  type moves in the simulation.
- **Instrument book** — add a stock, reclassify it, suspend it, or remove it
  once its position is closed.
- **Alerts** and **recent orders**.

Limits are enforced by the API, not just by the form. Turning trading off for a
type or lowering its position cap makes the server reject a breaching order
with a 422 and an explanation, whatever the client sends.

## How it fits together

```
shared/    Domain types and the per-type profiles, used by both sides.
server/    Express API + the market simulation.
  engine/  market (price paths), portfolio (derived figures),
           trading (order rules), alerts (threshold checks)
  store/   In-memory state, seeded, persisted to server/data/state.json
  routes/  REST endpoints and the SSE stream
web/       React + Vite front end.
  charts/  Hand-rolled SVG charts
  pages/   DashboardPage, ControlPage
```

The API keeps the book in memory and writes it to `server/data/state.json` at
most once a second, so a restart resumes where it left off. Delete that file to
start from the seed book again.

Prices move on a tick loop and are pushed to every open page over
Server-Sent Events (`GET /api/stream`), so two open tabs stay in step. Price
paths use a seeded PRNG: the same seed replays the same path, which is what
makes the engine testable.

### API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/portfolio` | Holdings, per-type summaries, totals |
| `GET` | `/api/history?points=` | Portfolio value samples |
| `GET` | `/api/instruments` | The book |
| `POST` | `/api/instruments` | Add a stock |
| `PATCH` | `/api/instruments/:id` | Rename, reclassify, suspend, reprice |
| `DELETE` | `/api/instruments/:id` | Remove (refused while a position is open) |
| `POST` | `/api/orders` | Place a market order |
| `GET` | `/api/orders?limit=` | Recent fills |
| `GET`/`PATCH` | `/api/controls[/:type]` | Per-type limits |
| `GET`/`PATCH` | `/api/engine` | Simulation settings |
| `GET` | `/api/alerts` | Alert feed |
| `POST` | `/api/alerts/:id/ack`, `/api/alerts/ack-all` | Acknowledge |
| `GET` | `/api/stream` | SSE: ticks, alerts, settings, book changes |

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | API port |
| `STOCKPLAY_DATA_FILE` | `server/data/state.json` | Where state is persisted |
| `STOCKPLAY_WEB_DIST` | auto-detected | Web bundle to serve from the API |
| `STOCKPLAY_API` | `http://localhost:4000` | Proxy target for the Vite dev server |

## Notes on the charts

Colours come from a categorical palette validated for colour-vision deficiency
in both light and dark mode; dark mode uses its own steps chosen for the dark
surface rather than a flipped light palette. Because the palette clears its
thresholds on *neighbouring* slots, the donut keeps the fixed type order instead
of sorting by value — which also stops the ring reshuffling on every tick.
Identity is never carried by colour alone: charts carry a legend and direct
labels, tables name the type in words, and up/down carries an arrow and a sign
as well as a colour.

## Caveats

The market is a simulation, not a feed, and the numbers it produces are not
advice about anything. There is no authentication: the server assumes it is
talking to one trusted local user, so do not expose it as-is.
