import type { ReactNode } from 'react';
import type { AssetType } from '../../../shared/src/types.js';
import { typeColor, typeLabel } from '../lib/assetTypes.js';
import { direction, directionGlyph, signedMoney, signedPercent } from '../lib/format.js';

export function Card({
  title,
  subtitle,
  actions,
  children,
  as: Heading = 'h2',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  as?: 'h2' | 'h3';
}) {
  return (
    <section className="card">
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <Heading>{title}</Heading>
          {subtitle ? <p className="card-sub">{subtitle}</p> : null}
        </div>
        {actions ? <div className="card-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  change,
  changeIsPercent = false,
  foot,
}: {
  label: string;
  value: string;
  change?: number;
  changeIsPercent?: boolean;
  foot?: ReactNode;
}) {
  return (
    <section className="card tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      <span className="tile-foot">
        {change !== undefined ? <Delta value={change} asPercent={changeIsPercent} /> : null}
        {foot}
      </span>
    </section>
  );
}

/** A signed change. The arrow and the sign carry the direction, so the two
 *  hues are a reinforcement rather than the only channel. */
export function Delta({ value, asPercent = false }: { value: number; asPercent?: boolean }) {
  const dir = direction(value, asPercent ? 1e-5 : 0.005);
  return (
    <span className={`delta delta-${dir}`}>
      <span aria-hidden="true">{directionGlyph[dir]}</span>
      {asPercent ? signedPercent(value) : signedMoney(value)}
    </span>
  );
}

export function TypeBadge({ type }: { type: AssetType }) {
  return (
    <span className="type-badge">
      <span className="type-dot" style={{ background: typeColor(type) }} aria-hidden="true" />
      {typeLabel(type)}
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  onLabel,
  offLabel,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  onLabel: string;
  offLabel: string;
  disabled?: boolean;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch-track" aria-hidden="true" />
      <span className="switch-text">{checked ? onLabel : offLabel}</span>
    </label>
  );
}

export function SliderField({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  hint?: string;
}) {
  const id = `slider-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="slider-row">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <span className="slider-value">{display}</span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint ? <span className="field-hint" style={{ gridColumn: '1 / -1' }}>{hint}</span> : null}
    </div>
  );
}

/** A weight bar with a tick marking the target — a meter, not a chart. */
export function AllocationMeter({
  weight,
  target,
  color,
  label,
}: {
  weight: number;
  target: number;
  color: string;
  label: string;
}) {
  const scale = Math.max(weight, target, 0.01) * 1.25;
  return (
    <div
      className="meter"
      role="img"
      aria-label={`${label}: ${(weight * 100).toFixed(1)}% held against a ${(target * 100).toFixed(0)}% target.`}
    >
      <div className="meter-fill" style={{ width: `${(weight / scale) * 100}%`, background: color }} />
      <div className="meter-target" style={{ left: `${(target / scale) * 100}%` }} />
    </div>
  );
}

export function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: 'error' | 'ok' | 'info';
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const icon = tone === 'error' ? '✕' : tone === 'ok' ? '✓' : 'i';
  return (
    <div className={`banner banner-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="banner-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
      {onDismiss ? (
        <button type="button" className="btn btn-sm banner-dismiss" onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

/** Swaps a chart for its table twin, so no value is reachable only by hover. */
export function ViewToggle({
  view,
  onChange,
  label,
}: {
  view: 'chart' | 'table';
  onChange: (next: 'chart' | 'table') => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={`${label} view`}>
      <button type="button" aria-pressed={view === 'chart'} onClick={() => onChange('chart')}>
        Chart
      </button>
      <button type="button" aria-pressed={view === 'table'} onClick={() => onChange('table')}>
        Table
      </button>
    </div>
  );
}
