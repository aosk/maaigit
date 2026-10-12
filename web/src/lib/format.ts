const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const currencyCents = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const integer = new Intl.NumberFormat('en-US');

export const money = (value: number): string => currency.format(value);
export const moneyCents = (value: number): string => currencyCents.format(value);
export const shares = (value: number): string => integer.format(value);

/** Axis ticks and other tight spots. */
export const moneyCompact = (value: number): string =>
  `${value < 0 ? '-' : ''}$${compact.format(Math.abs(value))}`;

export const percent = (value: number, digits = 1): string =>
  `${(value * 100).toFixed(digits)}%`;

/** A signed percentage, for changes where the direction matters. */
export const signedPercent = (value: number, digits = 2): string =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${(Math.abs(value) * 100).toFixed(digits)}%`;

export const signedMoney = (value: number): string =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${currency.format(Math.abs(value))}`;

export type Direction = 'up' | 'down' | 'flat';

/** Direction is carried by an arrow glyph and a sign as well as by color, so a
 *  reader who cannot separate the two hues still gets the answer. */
export function direction(value: number, epsilon = 1e-9): Direction {
  if (value > epsilon) return 'up';
  if (value < -epsilon) return 'down';
  return 'flat';
}

export const directionGlyph: Record<Direction, string> = {
  up: '▲',
  down: '▼',
  flat: '–',
};

export function clockTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function dayTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
