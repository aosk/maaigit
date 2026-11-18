/**
 * Turns whatever the monitoring site answers into things the screen can draw, without knowing its fields ahead of
 * time: single values become tiles, lists of rows become tables, and what is nested becomes a section of its own.
 */

export type Cell = string;
export interface Section {
  title: string;
  /** Single values: a name and what it is. */
  tiles: { name: string; value: Cell }[];
  /** Lists of rows. */
  tables: { title: string; columns: string[]; rows: Cell[][]; more: number }[];
}

const MAX_ROWS = 40;
const MAX_COLUMNS = 6;
const MAX_DEPTH = 3;

/** A field name as words: "error_rate" and "errorRate" both read "error rate". */
export function label(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').trim().toLowerCase();
}

/** A value as short text. Numbers get separators and at most two decimals; a date and time loses its seconds. */
export function show(value: unknown, locale = 'en'): Cell {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return Number.isFinite(value) ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value) : '—';
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value.slice(0, 16).replace('T', ' ');
    return value.length > 80 ? `${value.slice(0, 79)}…` : value;
  }
  if (Array.isArray(value)) return value.length && value.every((v) => typeof v !== 'object' || v === null) ? value.slice(0, 5).map((v) => show(v, locale)).join(', ') + (value.length > 5 ? '…' : '') : `(${value.length})`;
  return '{…}';
}

const plain = (v: unknown) => v === null || typeof v !== 'object';
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function table(title: string, list: unknown[], locale: string): Section['tables'][number] {
  const rows = list.slice(0, MAX_ROWS);
  if (rows.every(isRecord)) {
    // The columns are the plain fields the rows share, in the order they first appear.
    const columns: string[] = [];
    for (const row of rows) for (const [k, v] of Object.entries(row)) if (plain(v) && !columns.includes(k) && columns.length < MAX_COLUMNS) columns.push(k);
    return { title, columns: columns.map(label), rows: rows.map((row) => columns.map((c) => show(row[c], locale))), more: list.length - rows.length };
  }
  return { title, columns: [], rows: rows.map((v) => [show(v, locale)]), more: list.length - rows.length };
}

/** The sections to draw for an answer. `top` names the section holding the answer's own single values. */
export function sections(data: unknown, top: string, locale = 'en'): Section[] {
  const out: Section[] = [];
  const walk = (value: unknown, title: string, depth: number) => {
    if (Array.isArray(value)) {
      if (value.length) out.push({ title, tiles: [], tables: [table('', value, locale)] });
      return;
    }
    if (!isRecord(value)) {
      out.push({ title, tiles: [{ name: '', value: show(value, locale) }], tables: [] });
      return;
    }
    const section: Section = { title, tiles: [], tables: [] };
    out.push(section);
    for (const [k, v] of Object.entries(value)) {
      if (plain(v)) section.tiles.push({ name: label(k), value: show(v, locale) });
      else if (Array.isArray(v)) {
        if (v.length) section.tables.push(table(label(k), v, locale));
      } else if (depth < MAX_DEPTH) walk(v, title === top ? label(k) : `${title} · ${label(k)}`, depth + 1);
      else section.tiles.push({ name: label(k), value: '{…}' });
    }
    if (!section.tiles.length && !section.tables.length) out.splice(out.indexOf(section), 1);
  };
  walk(data, top, 0);
  return out;
}
