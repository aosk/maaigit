import { useMemo, useState } from 'react';
import type { AssetType } from '../../../shared/src/types.js';
import { useElementWidth } from '../lib/store.js';
import { money, percent, signedPercent } from '../lib/format.js';
import { typeColor, typeLabel, typeShort } from '../lib/assetTypes.js';
import { clampTooltipX, linearScale, niceTicks } from './chartUtils.js';

export interface TypeBar {
  type: AssetType;
  /** The plotted measure, a ratio such as 0.084 for +8.4%. */
  value: number;
  /** Shown in the tooltip for context. */
  marketValue: number;
}

interface Props {
  bars: TypeBar[];
  height?: number;
}

const MARGIN = { top: 14, right: 12, bottom: 30, left: 46 };
/** Below this band width the horizontal type labels start to collide, so they
 *  tilt instead. */
const TILT_BELOW_PX = 58;
const TILTED_BOTTOM = 52;
/** 4px rounded data-ends, anchored to the zero baseline. */
const END_RADIUS = 4;

/**
 * Return by stock type against a zero baseline. Bars carry each type's own
 * hue, the same one the donut and the badges use, so a reader who learned
 * "ETF is aqua" keeps that across the dashboard. The sign is carried by
 * direction and by the labelled value, not by color.
 */
export function TypeBarChart({ bars, height = 230 }: Props) {
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);

  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const band = bars.length > 0 ? plotWidth / bars.length : 0;
  const tilted = band > 0 && band < TILT_BELOW_PX;
  const bottom = tilted ? TILTED_BOTTOM : MARGIN.bottom;
  const plotHeight = height - MARGIN.top - bottom;

  const geometry = useMemo(() => {
    if (bars.length === 0 || plotWidth <= 0) return null;
    const values = bars.map((bar) => bar.value);
    const max = Math.max(0.01, ...values.map(Math.abs)) * 1.18;
    const y = linearScale([-max, max], [MARGIN.top + plotHeight, MARGIN.top]);
    const barWidth = Math.min(46, band * 0.54);

    return {
      y,
      band,
      barWidth,
      zero: y(0),
      ticks: niceTicks(-max, max, 4),
      centerOf: (index: number) => MARGIN.left + band * (index + 0.5),
    };
  }, [bars, plotWidth, plotHeight, band]);

  if (bars.length === 0) {
    return <div className="empty" style={{ height }}>No stock types selected.</div>;
  }

  const active = hovered !== null ? bars[hovered] : null;

  return (
    <div className="chart-box" ref={boxRef}>
      <svg height={height} viewBox={`0 0 ${Math.max(width, 1)} ${height}`} role="img"
        aria-label={`Return by stock type: ${bars.map((b) => `${typeLabel(b.type)} ${signedPercent(b.value)}`).join(', ')}.`}>
        {geometry?.ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + plotWidth}
              y1={geometry.y(tick)}
              y2={geometry.y(tick)}
              stroke={tick === 0 ? 'var(--axis)' : 'var(--grid)'}
              strokeWidth="1"
            />
            <text
              x={MARGIN.left - 8}
              y={geometry.y(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="11"
              fill="var(--text-muted)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {percent(tick, 0)}
            </text>
          </g>
        ))}

        {geometry &&
          bars.map((bar, index) => {
            const center = geometry.centerOf(index);
            const top = Math.min(geometry.zero, geometry.y(bar.value));
            const barHeight = Math.max(2, Math.abs(geometry.y(bar.value) - geometry.zero));
            const up = bar.value >= 0;

            return (
              <g
                key={bar.type}
                onPointerEnter={() => setHovered(index)}
                onPointerLeave={() => setHovered(null)}
              >
                {/* A hit area wider than the mark, so hovering is not a pinpoint task. */}
                <rect
                  x={center - geometry.band / 2}
                  y={MARGIN.top}
                  width={geometry.band}
                  height={plotHeight}
                  fill="transparent"
                />
                <path
                  d={
                    up
                      ? `M${center - geometry.barWidth / 2},${geometry.zero}` +
                        `L${center - geometry.barWidth / 2},${top + END_RADIUS}` +
                        `Q${center - geometry.barWidth / 2},${top} ${center - geometry.barWidth / 2 + END_RADIUS},${top}` +
                        `L${center + geometry.barWidth / 2 - END_RADIUS},${top}` +
                        `Q${center + geometry.barWidth / 2},${top} ${center + geometry.barWidth / 2},${top + END_RADIUS}` +
                        `L${center + geometry.barWidth / 2},${geometry.zero}Z`
                      : `M${center - geometry.barWidth / 2},${geometry.zero}` +
                        `L${center - geometry.barWidth / 2},${top + barHeight - END_RADIUS}` +
                        `Q${center - geometry.barWidth / 2},${top + barHeight} ${center - geometry.barWidth / 2 + END_RADIUS},${top + barHeight}` +
                        `L${center + geometry.barWidth / 2 - END_RADIUS},${top + barHeight}` +
                        `Q${center + geometry.barWidth / 2},${top + barHeight} ${center + geometry.barWidth / 2},${top + barHeight - END_RADIUS}` +
                        `L${center + geometry.barWidth / 2},${geometry.zero}Z`
                  }
                  fill={typeColor(bar.type)}
                  opacity={hovered !== null && hovered !== index ? 0.45 : 1}
                  style={{ transition: 'opacity 120ms ease' }}
                />
                <text
                  x={center}
                  y={up ? top - 6 : top + barHeight + 13}
                  textAnchor="middle"
                  fontSize="11.5"
                  fontWeight="600"
                  fill="var(--text-secondary)"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {signedPercent(bar.value, 1)}
                </text>
                <text
                  x={center}
                  y={MARGIN.top + plotHeight + (tilted ? 14 : 18)}
                  textAnchor={tilted ? 'end' : 'middle'}
                  transform={tilted ? `rotate(-35 ${center} ${MARGIN.top + plotHeight + 14})` : undefined}
                  fontSize="11"
                  fill="var(--text-muted)"
                >
                  {typeShort[bar.type]}
                </text>
              </g>
            );
          })}
      </svg>

      {active && geometry && (
        <div
          className="tooltip"
          style={{
            left: clampTooltipX(geometry.centerOf(hovered!), width),
            top: Math.min(geometry.zero, geometry.y(active.value)),
          }}
        >
          <div className="tooltip-title">{typeLabel(active.type)}</div>
          <div className="tooltip-row">
            <span className="tooltip-key">
              <span className="legend-swatch" style={{ background: typeColor(active.type) }} />
              Return
            </span>
            <span>{signedPercent(active.value)}</span>
          </div>
          <div className="tooltip-row">
            <span className="tooltip-key">Market value</span>
            <span>{money(active.marketValue)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
