import { ASSET_TYPES, ASSET_TYPE_PROFILES, type AssetType } from '../../../shared/src/types.js';

export { ASSET_TYPES, ASSET_TYPE_PROFILES };
export type { AssetType };

/**
 * Each asset type owns one categorical slot, assigned once and never
 * reassigned. Filtering a type out of a view must not repaint the survivors,
 * so every chart, badge and swatch reads its color from here.
 */
const SLOT: Record<AssetType, number> = {
  COMMON: 1,
  PREFERRED: 2,
  ETF: 3,
  REIT: 4,
  ADR: 5,
  MUTUAL_FUND: 6,
};

export const typeColor = (type: AssetType): string => `var(--series-${SLOT[type]})`;
export const typeLabel = (type: AssetType): string => ASSET_TYPE_PROFILES[type].label;
export const typeBlurb = (type: AssetType): string => ASSET_TYPE_PROFILES[type].blurb;

/** Short label for axis ticks and other narrow spots. */
export const typeShort: Record<AssetType, string> = {
  COMMON: 'Common',
  PREFERRED: 'Preferred',
  ETF: 'ETF',
  REIT: 'REIT',
  ADR: 'ADR',
  MUTUAL_FUND: 'Fund',
};
