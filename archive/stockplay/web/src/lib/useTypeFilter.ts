import { useCallback, useEffect, useState } from 'react';
import { ASSET_TYPES, type AssetType } from './assetTypes.js';

const KEY = 'stockplay:types';

function readSaved(): Set<AssetType> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      const valid = parsed.filter((t): t is AssetType =>
        (ASSET_TYPES as readonly string[]).includes(t),
      );
      if (valid.length) return new Set(valid);
    }
  } catch {
    /* blocked or cleared storage — everything selected is a fine default */
  }
  return new Set(ASSET_TYPES);
}

/** The stock-type filter, shared by the dashboard and the control page and
 *  remembered per viewer so switching pages keeps the same slice. */
export function useTypeFilter() {
  const [selected, setSelected] = useState<Set<AssetType>>(readSaved);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify([...selected]));
    } catch {
      /* not remembering the choice is survivable */
    }
  }, [selected]);

  const toggle = useCallback((type: AssetType) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => setSelected(new Set(ASSET_TYPES)), []);

  return { selected, toggle, selectAll };
}
