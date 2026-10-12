import { useMemo, useState } from 'react';
import type { AssetType } from '../../../shared/src/types.js';
import { useElementWidth } from '../lib/store.js';
import { money, percent } from '../lib/format.js';
import { ASSET_TYPES, typeColor, typeLabel } from '../lib/assetTypes.js';
import { arcPath } from './chartUtils.js';

export interface Slice {
  type: AssetType;
  value: number;
}

interface Props {
  slices: Slice[];
  height?: number;
}

/** Segments are separated by a 2px gap of surface, not by a stroke. */
const GAP_PX = 2;

/**
 * Part-to-whole at a glance across at most six stock types. Each type keeps
 * its own hue whatever is filtered in or out, and the legend repeats the value
 * so identity never rests on color alone.
 */
export function AllocationDonut({ slices, height = 220 }: Props) {
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const [hovered, setHovered] = useState<AssetType | null>(null);

  // Segments keep the fixed asset-type order rather than sorting by value.
  // Two reasons: the palette is validated on the *adjacent* pairlist, so
  // neighbours must be predictable slots; and a ring that re-sorts on every
  // tick would churn under the reader.
  const rows = useMemo(
    () =>
      ASSET_TYPES.filter((type) => slices.some((slice) => slice.type === type && slice.value > 0))
        .map((type) => slices.find((slice) => slice.type === type)!),
    [slices],
  );
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  const geometry = useMemo(() => {
    if (total <= 0 || width <= 0) return null;
    const size = Math.min(width, height);
    const cx = width / 2;
    const cy = height / 2;
    const outer = size / 2 - 4;
    const inner = outer * 0.62;
    const gapAngle = GAP_PX / outer;

    let angle = -Math.PI / 2;
    return {
      cx,
      cy,
      inner,
      outer,
      arcs: rows.map((row) => {
        const sweep = (row.value / total) * Math.PI * 2;
        const start = angle + gapAngle / 2;
        const end = angle + sweep - gapAngle / 2;
        angle += sweep;
        return { row, start, end: Math.max(end, start + 0.001) };
      }),
    };
  }, [rows, total, width, height]);

  if (total <= 0) {
    return <div className="empty" style={{ height }}>No value in the selected stock types.</div>;
  }

  const focus = hovered ? rows.find((row) => row.type === hovered) : null;

  return (
    <div className="chart-box" ref={boxRef}>
      <svg height={height} viewBox={`0 0 ${Math.max(width, 1)} ${height}`} role="img"
        aria-label={`Allocation by stock type: ${rows.map((r) => `${typeLabel(r.type)} ${percent(r.value / total)}`).join(', ')}.`}>
        {geometry?.arcs.map(({ row, start, end }) => (
          <path
            key={row.type}
            d={arcPath(geometry.cx, geometry.cy, geometry.outer, geometry.inner, start, end)}
            fill={typeColor(row.type)}
            opacity={hovered && hovered !== row.type ? 0.42 : 1}
            onPointerEnter={() => setHovered(row.type)}
            onPointerLeave={() => setHovered(null)}
            style={{ cursor: 'default', transition: 'opacity 120ms ease' }}
          >
            <title>{`${typeLabel(row.type)}: ${money(row.value)} (${percent(row.value / total)})`}</title>
          </path>
        ))}

        {geometry && (
          <>
            <text
              x={geometry.cx}
              y={geometry.cy - 6}
              textAnchor="middle"
              fontSize="19"
              fontWeight="650"
              fill="var(--text-primary)"
            >
              {focus ? percent(focus.value / total) : money(total)}
            </text>
            <text
              x={geometry.cx}
              y={geometry.cy + 14}
              textAnchor="middle"
              fontSize="11.5"
              fill="var(--text-secondary)"
            >
              {focus ? typeLabel(focus.type) : 'Selected value'}
            </text>
          </>
        )}
      </svg>

      <div className="legend">
        {rows.map((row) => (
          <span className="legend-item" key={row.type}>
            <span className="legend-swatch" style={{ background: typeColor(row.type) }} />
            {typeLabel(row.type)}
            <span className="legend-value">{percent(row.value / total)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
