import { useMemo, useState } from 'react';
import { useElementWidth } from '../lib/store.js';
import { dayTime, moneyCents, moneyCompact } from '../lib/format.js';
import {
  areaPath,
  clampTooltipX,
  linePath,
  linearScale,
  niceTicks,
  paddedDomain,
} from './chartUtils.js';

export interface ValuePoint {
  t: string;
  value: number;
}

interface Props {
  points: ValuePoint[];
  /** Named in the card title, so a single series needs no legend box. */
  label: string;
  height?: number;
}

const MARGIN = { top: 12, right: 14, bottom: 26, left: 58 };

/**
 * One series, one axis: the value of the selected stock types over the
 * simulated session. Hover or arrow-key focus moves a crosshair; the value is
 * also reachable from the card's table view, so the tooltip never gates it.
 */
export function ValueLineChart({ points, label, height = 260 }: Props) {
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = height - MARGIN.top - MARGIN.bottom;

  const geometry = useMemo(() => {
    if (points.length === 0 || plotWidth <= 0) return null;
    const values = points.map((p) => p.value);
    const domain = paddedDomain(values);
    const y = linearScale(domain, [MARGIN.top + plotHeight, MARGIN.top]);
    const x = linearScale([0, Math.max(1, points.length - 1)], [MARGIN.left, MARGIN.left + plotWidth]);
    const coords = points.map((p, i) => [x(i), y(p.value)] as [number, number]);

    return {
      coords,
      x,
      y,
      ticks: niceTicks(domain[0], domain[1], 5),
      first: values[0],
      last: values[values.length - 1],
    };
  }, [points, plotWidth, plotHeight]);

  const pick = (clientX: number, rect: DOMRect) => {
    if (!geometry) return;
    const local = clientX - rect.left;
    const ratio = (local - MARGIN.left) / Math.max(1, plotWidth);
    const index = Math.round(ratio * (points.length - 1));
    setActiveIndex(Math.min(points.length - 1, Math.max(0, index)));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!geometry) return;
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (step === 0) return;
    event.preventDefault();
    setActiveIndex((prev) => {
      const base = prev ?? points.length - 1;
      return Math.min(points.length - 1, Math.max(0, base + step));
    });
  };

  if (points.length === 0) {
    return (
      <div className="empty" style={{ height }}>
        No history for the selected stock types yet.
      </div>
    );
  }

  const active = activeIndex !== null && geometry ? points[activeIndex] : null;
  const rising = geometry ? geometry.last >= geometry.first : true;

  return (
    <div className="chart-box" ref={boxRef}>
      <svg
        height={height}
        viewBox={`0 0 ${Math.max(width, 1)} ${height}`}
        role="img"
        aria-label={`${label} over time, from ${moneyCents(points[0].value)} to ${moneyCents(points[points.length - 1].value)}.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => setActiveIndex(null)}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setActiveIndex(null)}
        style={{ touchAction: 'pan-y' }}
      >
        <defs>
          <linearGradient id="value-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Recessive grid: solid hairlines, one shade off the surface. */}
        {geometry?.ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + plotWidth}
              y1={geometry.y(tick)}
              y2={geometry.y(tick)}
              stroke="var(--grid)"
              strokeWidth="1"
            />
            <text
              x={MARGIN.left - 9}
              y={geometry.y(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="11"
              fill="var(--text-muted)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {moneyCompact(tick)}
            </text>
          </g>
        ))}

        {geometry && (
          <>
            <path d={areaPath(geometry.coords, MARGIN.top + plotHeight)} fill="url(#value-fill)" />
            <path
              d={linePath(geometry.coords)}
              fill="none"
              stroke="var(--series-1)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* Direct-label the endpoint only; the axis and tooltip carry the rest. */}
            <circle
              cx={geometry.coords[geometry.coords.length - 1][0]}
              cy={geometry.coords[geometry.coords.length - 1][1]}
              r="4"
              fill="var(--series-1)"
              stroke="var(--surface-1)"
              strokeWidth="2"
            />

            <line
              x1={MARGIN.left}
              x2={MARGIN.left + plotWidth}
              y1={MARGIN.top + plotHeight}
              y2={MARGIN.top + plotHeight}
              stroke="var(--axis)"
              strokeWidth="1"
            />

            {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((index, i) => (
              <text
                key={index}
                x={geometry.x(index)}
                y={MARGIN.top + plotHeight + 16}
                textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
                fontSize="11"
                fill="var(--text-muted)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {dayTime(points[index].t)}
              </text>
            ))}

            {activeIndex !== null && (
              <g>
                <line
                  x1={geometry.x(activeIndex)}
                  x2={geometry.x(activeIndex)}
                  y1={MARGIN.top}
                  y2={MARGIN.top + plotHeight}
                  stroke="var(--axis)"
                  strokeWidth="1"
                />
                <circle
                  cx={geometry.coords[activeIndex][0]}
                  cy={geometry.coords[activeIndex][1]}
                  r="5"
                  fill="var(--series-1)"
                  stroke="var(--surface-1)"
                  strokeWidth="2"
                />
              </g>
            )}
          </>
        )}
      </svg>

      {active && geometry && (
        <div
          className="tooltip"
          style={{
            left: clampTooltipX(geometry.x(activeIndex!), width),
            top: geometry.coords[activeIndex!][1],
          }}
        >
          <div className="tooltip-title">{dayTime(active.t)}</div>
          <div className="tooltip-row">
            <span className="tooltip-key">
              <span className="legend-swatch" style={{ background: 'var(--series-1)' }} />
              {label}
            </span>
            <span>{moneyCents(active.value)}</span>
          </div>
        </div>
      )}

      {geometry ? (
        <p className="card-sub" style={{ marginTop: 8 }}>
          {rising ? 'Up' : 'Down'} {moneyCents(Math.abs(geometry.last - geometry.first))} across the
          window shown. Hover the chart, or focus it and use ← →, to read any point.
        </p>
      ) : null}
    </div>
  );
}
