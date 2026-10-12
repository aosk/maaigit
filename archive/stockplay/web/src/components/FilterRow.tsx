import type { AssetType } from '../../../shared/src/types.js';
import { ASSET_TYPES, typeColor, typeShort } from '../lib/assetTypes.js';

export const RANGE_OPTIONS = [
  { key: '60', label: '1 session', points: 78 },
  { key: '240', label: '3 sessions', points: 234 },
  { key: 'all', label: 'All', points: Number.MAX_SAFE_INTEGER },
] as const;

export type RangeKey = (typeof RANGE_OPTIONS)[number]['key'];

interface Props {
  selected: Set<AssetType>;
  onToggle: (type: AssetType) => void;
  onSelectAll: () => void;
  range?: RangeKey;
  onRangeChange?: (next: RangeKey) => void;
  /** Right-hand slot, for anything that belongs on the row but is not a filter. */
  trailing?: React.ReactNode;
}

/**
 * One filter row above everything it scopes — never a filter inside a chart
 * card. Every chart and table below re-renders against the same slice.
 */
export function FilterRow({
  selected,
  onToggle,
  onSelectAll,
  range,
  onRangeChange,
  trailing,
}: Props) {
  const allOn = selected.size === ASSET_TYPES.length;

  return (
    <div className="filter-row">
      <span className="filter-label" id="type-filter-label">
        Stock type
      </span>
      <div className="filter-chips" role="group" aria-labelledby="type-filter-label">
        {ASSET_TYPES.map((type) => {
          const on = selected.has(type);
          return (
            <button
              key={type}
              type="button"
              className="chip"
              aria-pressed={on}
              onClick={() => onToggle(type)}
            >
              <span className="chip-swatch" style={{ background: typeColor(type) }} aria-hidden="true" />
              {typeShort[type]}
              <span className="chip-check" aria-hidden="true">
                {on ? '✓' : ''}
              </span>
            </button>
          );
        })}
      </div>

      <button type="button" className="btn btn-sm" onClick={onSelectAll} disabled={allOn}>
        Select all
      </button>

      {range && onRangeChange ? (
        <>
          <span className="filter-sep" aria-hidden="true" />
          <span className="filter-label" id="range-filter-label">
            Window
          </span>
          <div className="segmented" role="group" aria-labelledby="range-filter-label">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={range === option.key}
                onClick={() => onRangeChange(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {trailing ? <div style={{ marginLeft: 'auto' }}>{trailing}</div> : null}
    </div>
  );
}

/** Which type a filter set accepts. An empty set means "nothing selected",
 *  which the pages render as an explicit empty state rather than silently
 *  showing everything. */
export function accepts(selected: Set<AssetType>, type: AssetType): boolean {
  return selected.has(type);
}
