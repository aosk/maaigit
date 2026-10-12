export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Produces round axis values (1, 2, 2.5, 5 × 10ⁿ) across a domain. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) return [min];

  const span = max - min;
  const rawStep = span / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) *
    magnitude;

  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-6; value += step) {
    // Guard against binary-float drift producing -0 or 0.30000000000000004.
    ticks.push(Math.abs(value) < step * 1e-9 ? 0 : Number(value.toFixed(10)));
  }
  return ticks;
}

/** Pads a domain so the line never rides the top or bottom edge of the plot. */
export function paddedDomain(values: number[], padRatio = 0.08): [number, number] {
  if (values.length === 0) return [0, 1];
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === max) {
    const pad = Math.abs(min) * padRatio || 1;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * padRatio;
  return [min - pad, max + pad];
}

export function linearScale(
  domain: [number, number],
  range: [number, number],
): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

/** A plain polyline path; no curve smoothing, which would invent values
 *  between the samples. */
export function linePath(points: Array<[number, number]>): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join('');
}

export function areaPath(points: Array<[number, number]>, baseline: number): string {
  if (points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath(points)}L${last[0].toFixed(2)},${baseline.toFixed(2)}L${first[0].toFixed(2)},${baseline.toFixed(2)}Z`;
}

/** SVG arc for one donut segment. */
export function arcPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  const x = (r: number, a: number) => cx + r * Math.cos(a);
  const y = (r: number, a: number) => cy + r * Math.sin(a);

  return [
    `M${x(outerRadius, startAngle)},${y(outerRadius, startAngle)}`,
    `A${outerRadius},${outerRadius} 0 ${large} 1 ${x(outerRadius, endAngle)},${y(outerRadius, endAngle)}`,
    `L${x(innerRadius, endAngle)},${y(innerRadius, endAngle)}`,
    `A${innerRadius},${innerRadius} 0 ${large} 0 ${x(innerRadius, startAngle)},${y(innerRadius, startAngle)}`,
    'Z',
  ].join('');
}

/** Keeps a tooltip inside its container instead of letting it run off the edge. */
export function clampTooltipX(x: number, width: number, halfWidth = 85): number {
  return Math.min(Math.max(x, halfWidth), Math.max(halfWidth, width - halfWidth));
}
