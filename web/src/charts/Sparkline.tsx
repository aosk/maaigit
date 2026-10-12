import { linePath, linearScale, paddedDomain } from './chartUtils.js';

interface Props {
  values: number[];
  color: string;
  width?: number;
  height?: number;
  label: string;
}

/** A small multiple: the same shape repeated per row so trends compare by
 *  position rather than by another color. No axis, no tooltip — the row's own
 *  columns carry the numbers. */
export function Sparkline({ values, color, width = 92, height = 26, label }: Props) {
  if (values.length < 2) {
    return <span className="sym-name">—</span>;
  }

  const domain = paddedDomain(values, 0.12);
  const y = linearScale(domain, [height - 2, 2]);
  const x = linearScale([0, values.length - 1], [1, width - 1]);
  const coords = values.map((value, i) => [x(i), y(value)] as [number, number]);
  const last = coords[coords.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      style={{ display: 'block' }}
    >
      <path d={linePath(coords)} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} stroke="var(--surface-1)" strokeWidth="1.5" />
    </svg>
  );
}
