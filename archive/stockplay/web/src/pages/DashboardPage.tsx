import { useMemo, useState } from 'react';
import type { AssetType, HoldingView } from '../../../shared/src/types.js';
import { AllocationDonut } from '../charts/AllocationDonut.js';
import { Sparkline } from '../charts/Sparkline.js';
import { TypeBarChart } from '../charts/TypeBarChart.js';
import { ValueLineChart } from '../charts/ValueLineChart.js';
import { AlertList } from '../components/AlertList.js';
import { FilterRow, RANGE_OPTIONS, type RangeKey } from '../components/FilterRow.js';
import {
  AllocationMeter,
  Banner,
  Card,
  Delta,
  StatTile,
  TypeBadge,
  ViewToggle,
} from '../components/ui.js';
import { typeColor, typeLabel } from '../lib/assetTypes.js';
import {
  money,
  moneyCents,
  percent,
  shares,
  signedMoney,
  signedPercent,
} from '../lib/format.js';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { useTypeFilter } from '../lib/useTypeFilter.js';

type SortKey = 'symbol' | 'type' | 'marketValue' | 'dayChangePct' | 'unrealizedPnLPct' | 'weight';

export function DashboardPage() {
  const { portfolio, history, alerts, loadError, ready, setAlerts } = useStore();
  const { selected, toggle, selectAll } = useTypeFilter();
  const [range, setRange] = useState<RangeKey>('240');
  const [valueView, setValueView] = useState<'chart' | 'table'>('chart');
  const [mixView, setMixView] = useState<'chart' | 'table'>('chart');
  const [returnView, setReturnView] = useState<'chart' | 'table'>('chart');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: 'marketValue',
    desc: true,
  });

  const windowPoints = RANGE_OPTIONS.find((option) => option.key === range)?.points ?? 234;

  // Everything below is derived from the same slice: the selected stock types
  // over the selected window.
  const sliced = useMemo(
    () => (history.length > windowPoints ? history.slice(history.length - windowPoints) : history),
    [history, windowPoints],
  );

  const valueSeries = useMemo(
    () =>
      sliced.map((point) => ({
        t: point.t,
        value: [...selected].reduce((sum, type) => sum + (point.byType[type] ?? 0), 0),
      })),
    [sliced, selected],
  );

  const typeSeries = useMemo(() => {
    const out = {} as Record<AssetType, number[]>;
    for (const type of selected) out[type] = sliced.map((point) => point.byType[type] ?? 0);
    return out;
  }, [sliced, selected]);

  const rows = useMemo(
    () => portfolio?.byType.filter((row) => selected.has(row.type)) ?? [],
    [portfolio, selected],
  );

  const holdings = useMemo(() => {
    const list = (portfolio?.holdings ?? []).filter((h) => selected.has(h.type));
    const factor = sort.desc ? -1 : 1;
    return [...list].sort((a, b) => {
      if (sort.key === 'symbol') return factor * a.symbol.localeCompare(b.symbol);
      if (sort.key === 'type') return factor * a.type.localeCompare(b.type);
      return factor * ((a[sort.key] as number) - (b[sort.key] as number));
    });
  }, [portfolio, selected, sort]);

  const selectedValue = rows.reduce((sum, row) => sum + row.marketValue, 0);
  const selectedCost = rows.reduce((sum, row) => sum + row.costBasis, 0);
  const selectedDay = rows.reduce((sum, row) => sum + row.dayChange, 0);
  const selectedPnL = selectedValue - selectedCost;
  const openAlerts = alerts.filter((alert) => !alert.acknowledged && selected.has(alert.type));

  const ack = async (id: string) => {
    setAlerts(alerts.map((alert) => (alert.id === id ? { ...alert, acknowledged: true } : alert)));
    try {
      await api.ackAlert(id);
    } catch {
      // The stream will correct the row on the next refresh.
    }
  };

  const sortable = (key: SortKey, label: string) => (
    <th
      className="sortable"
      scope="col"
      aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
      onClick={() => setSort((prev) => ({ key, desc: prev.key === key ? !prev.desc : true }))}
    >
      {label}
      {sort.key === key ? <span aria-hidden="true"> {sort.desc ? '↓' : '↑'}</span> : null}
    </th>
  );

  if (loadError && !ready) {
    return (
      <Banner tone="error">
        {loadError} Start the API with <code>npm run dev:server</code> and reload.
      </Banner>
    );
  }
  if (!portfolio) return <div className="empty">Loading the book…</div>;

  const nothingSelected = selected.size === 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Portfolio dashboard</h1>
          <p>
            Value, mix and return across every stock type you hold. Everything below is scoped by
            the filter row.
          </p>
        </div>
      </div>

      <FilterRow
        selected={selected}
        onToggle={toggle}
        onSelectAll={selectAll}
        range={range}
        onRangeChange={setRange}
      />

      {nothingSelected ? (
        <Banner tone="info">
          No stock types selected. Pick at least one above, or choose <strong>Select all</strong>.
        </Banner>
      ) : null}

      <div className="grid grid-tiles" style={{ marginBottom: 16 }}>
        <StatTile
          label="Total portfolio"
          value={money(portfolio.totalValue)}
          change={portfolio.dayChange}
          foot={<span>today, all types</span>}
        />
        <StatTile
          label="Selected value"
          value={money(selectedValue)}
          change={selectedDay}
          foot={<span>{rows.length} of 6 types</span>}
        />
        <StatTile
          label="Unrealized P/L"
          value={signedMoney(selectedPnL)}
          change={selectedCost === 0 ? 0 : selectedPnL / selectedCost}
          changeIsPercent
          foot={<span>on {money(selectedCost)} cost</span>}
        />
        <StatTile
          label="Cash"
          value={money(portfolio.cash)}
          foot={<span>{money(portfolio.income)} income credited</span>}
        />
      </div>

      <div className="grid grid-main" style={{ marginBottom: 16 }}>
        <Card
          title="Value of selected stock types"
          subtitle={`${valueSeries.length} samples over the ${
            RANGE_OPTIONS.find((o) => o.key === range)?.label.toLowerCase()
          } window`}
          actions={<ViewToggle view={valueView} onChange={setValueView} label="Value" />}
        >
          {valueView === 'chart' ? (
            <ValueLineChart points={valueSeries} label="Selected value" />
          ) : (
            <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
              <table className="data">
                <caption>Every sample in the window, newest first.</caption>
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {[...valueSeries].reverse().map((point) => (
                    <tr key={point.t}>
                      <td>{new Date(point.t).toLocaleString('en-US', { hour12: false })}</td>
                      <td>{moneyCents(point.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Mix by stock type"
          subtitle="Share of the selected market value"
          actions={<ViewToggle view={mixView} onChange={setMixView} label="Mix" />}
        >
          {mixView === 'chart' ? (
            <AllocationDonut slices={rows.map((row) => ({ type: row.type, value: row.marketValue }))} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Value</th>
                    <th scope="col">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.type}>
                      <td>
                        <TypeBadge type={row.type} />
                      </td>
                      <td>{money(row.marketValue)}</td>
                      <td>{percent(selectedValue === 0 ? 0 : row.marketValue / selectedValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-halves" style={{ marginBottom: 16 }}>
        <Card
          title="Return by stock type"
          subtitle="Unrealized gain or loss against average cost"
          actions={<ViewToggle view={returnView} onChange={setReturnView} label="Return" />}
        >
          {returnView === 'chart' ? (
            <TypeBarChart
              bars={rows.map((row) => ({
                type: row.type,
                value: row.unrealizedPnLPct,
                marketValue: row.marketValue,
              }))}
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Cost</th>
                    <th scope="col">Value</th>
                    <th scope="col">Return</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.type}>
                      <td>
                        <TypeBadge type={row.type} />
                      </td>
                      <td>{money(row.costBasis)}</td>
                      <td>{money(row.marketValue)}</td>
                      <td>{signedPercent(row.unrealizedPnLPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Held against target"
          subtitle="Weight of invested value versus the target set on the control page"
        >
          {rows.length === 0 ? (
            <div className="empty">No stock types selected.</div>
          ) : (
            <div className="stack" style={{ gap: 12, marginTop: 10 }}>
              {rows.map((row) => (
                <div key={row.type}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 10,
                      marginBottom: 5,
                      fontSize: 12.5,
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                      <TypeBadge type={row.type} />
                      <span className="type-trend">
                        <Sparkline
                          values={typeSeries[row.type] ?? []}
                          color={typeColor(row.type)}
                          label={`${typeLabel(row.type)} value over the window`}
                          width={70}
                          height={18}
                        />
                      </span>
                    </span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>
                      {percent(row.weight)} held · {percent(row.targetAllocation, 0)} target ·{' '}
                      <strong style={{ color: 'var(--text-primary)' }}>
                        {row.drift >= 0 ? '+' : '−'}
                        {(Math.abs(row.drift) * 100).toFixed(1)}pp
                      </strong>
                    </span>
                  </div>
                  <AllocationMeter
                    weight={row.weight}
                    target={row.targetAllocation}
                    color={typeColor(row.type)}
                    label={typeLabel(row.type)}
                  />
                </div>
              ))}
              <p className="card-sub">
                The vertical tick is the target weight. Bars are scaled to the larger of the two.
              </p>
            </div>
          )}
        </Card>

        <Card
          title="Open alerts"
          subtitle="Raised by the thresholds on the control page"
          actions={
            openAlerts.length > 0 ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  setAlerts(alerts.map((alert) => ({ ...alert, acknowledged: true })));
                  try {
                    await api.ackAllAlerts();
                  } catch {
                    /* the next poll will reconcile */
                  }
                }}
              >
                Ack all
              </button>
            ) : null
          }
        >
          <AlertList
            alerts={openAlerts}
            onAck={ack}
            emptyMessage="Nothing over threshold in the selected stock types."
          />
        </Card>
      </div>

      <Card
        title="Holdings"
        subtitle={`${holdings.length} position${holdings.length === 1 ? '' : 's'} in the selected stock types`}
      >
          {holdings.length === 0 ? (
            <div className="empty">No positions in the selected stock types.</div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    {sortable('symbol', 'Symbol')}
                    {sortable('type', 'Type')}
                    <th scope="col">Qty</th>
                    <th scope="col">Price</th>
                    <th scope="col">Avg cost</th>
                    {sortable('marketValue', 'Value')}
                    {sortable('dayChangePct', 'Day')}
                    {sortable('unrealizedPnLPct', 'Return')}
                    {sortable('weight', 'Weight')}
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((holding) => (
                    <HoldingRow key={holding.instrumentId} holding={holding} />
                  ))}
                </tbody>
              </table>
            </div>
        )}
      </Card>
    </>
  );
}

function HoldingRow({ holding }: { holding: HoldingView }) {
  return (
    <tr>
      <td>
        <span className="sym">{holding.symbol}</span>
        <br />
        <span className="sym-name">{holding.name}</span>
      </td>
      <td style={{ textAlign: 'left' }}>
        <TypeBadge type={holding.type} />
      </td>
      <td>{shares(holding.quantity)}</td>
      <td>{moneyCents(holding.price)}</td>
      <td>{moneyCents(holding.averageCost)}</td>
      <td>{money(holding.marketValue)}</td>
      <td>
        <Delta value={holding.dayChangePct} asPercent />
      </td>
      <td>
        <Delta value={holding.unrealizedPnLPct} asPercent />
      </td>
      <td>{percent(holding.weight)}</td>
    </tr>
  );
}
