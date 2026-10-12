import type { Instrument, Position } from '../../../shared/src/types.js';

interface SeedRow {
  symbol: string;
  name: string;
  type: Instrument['type'];
  exchange: string;
  sector: string;
  currency: string;
  price: number;
  quantity: number;
  averageCost: number;
}

/** A starting book that holds every supported stock type, so the dashboard has
 *  something to say the first time it is opened. */
export const SEED_ROWS: SeedRow[] = [
  { symbol: 'NVCR', name: 'Novacore Systems', type: 'COMMON', exchange: 'NASDAQ', sector: 'Technology', currency: 'USD', price: 184.2, quantity: 180, averageCost: 141.05 },
  { symbol: 'HLMK', name: 'Hallmark Industrial', type: 'COMMON', exchange: 'NYSE', sector: 'Industrials', currency: 'USD', price: 96.4, quantity: 260, averageCost: 88.7 },
  { symbol: 'BRWD', name: 'Brightwood Health', type: 'COMMON', exchange: 'NYSE', sector: 'Healthcare', currency: 'USD', price: 57.85, quantity: 310, averageCost: 63.2 },
  { symbol: 'KELP', name: 'Kelso Payments', type: 'COMMON', exchange: 'NASDAQ', sector: 'Financials', currency: 'USD', price: 122.6, quantity: 140, averageCost: 118.4 },

  { symbol: 'HLMK.PR', name: 'Hallmark Industrial 6.25% Pfd A', type: 'PREFERRED', exchange: 'NYSE', sector: 'Industrials', currency: 'USD', price: 25.4, quantity: 600, averageCost: 24.9 },
  { symbol: 'ATLS.PR', name: 'Atlas Utilities 5.75% Pfd B', type: 'PREFERRED', exchange: 'NYSE', sector: 'Utilities', currency: 'USD', price: 24.1, quantity: 450, averageCost: 25.3 },

  { symbol: 'BRDX', name: 'Broad Market 500 ETF', type: 'ETF', exchange: 'ARCA', sector: 'Diversified', currency: 'USD', price: 512.3, quantity: 90, averageCost: 438.15 },
  { symbol: 'SMLC', name: 'Small Cap Core ETF', type: 'ETF', exchange: 'ARCA', sector: 'Diversified', currency: 'USD', price: 214.75, quantity: 70, averageCost: 205.6 },
  { symbol: 'TECX', name: 'Technology Sector ETF', type: 'ETF', exchange: 'ARCA', sector: 'Technology', currency: 'USD', price: 168.9, quantity: 110, averageCost: 132.4 },

  { symbol: 'PKRE', name: 'Parkline Retail REIT', type: 'REIT', exchange: 'NYSE', sector: 'Real Estate', currency: 'USD', price: 41.2, quantity: 380, averageCost: 46.8 },
  { symbol: 'STOR', name: 'Stormont Logistics REIT', type: 'REIT', exchange: 'NYSE', sector: 'Real Estate', currency: 'USD', price: 68.55, quantity: 190, averageCost: 61.3 },

  { symbol: 'NSEA', name: 'Nordsea Energy ADR', type: 'ADR', exchange: 'NYSE', sector: 'Energy', currency: 'USD', price: 78.4, quantity: 150, averageCost: 70.1 },
  { symbol: 'KYTO', name: 'Kyoto Robotics ADR', type: 'ADR', exchange: 'NASDAQ', sector: 'Technology', currency: 'USD', price: 39.95, quantity: 320, averageCost: 44.7 },

  { symbol: 'BALFX', name: 'Beacon Balanced Fund', type: 'MUTUAL_FUND', exchange: 'NAV', sector: 'Diversified', currency: 'USD', price: 63.4, quantity: 420, averageCost: 58.9 },
  { symbol: 'INCFX', name: 'Beacon Income Fund', type: 'MUTUAL_FUND', exchange: 'NAV', sector: 'Diversified', currency: 'USD', price: 31.2, quantity: 510, averageCost: 30.4 },
];

export const SEED_CASH = 48_500;

export function buildSeed(now: string): { instruments: Instrument[]; positions: Position[] } {
  const instruments: Instrument[] = [];
  const positions: Position[] = [];

  for (const row of SEED_ROWS) {
    const id = `ins_${row.symbol.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    instruments.push({
      id,
      symbol: row.symbol,
      name: row.name,
      type: row.type,
      exchange: row.exchange,
      sector: row.sector,
      currency: row.currency,
      price: row.price,
      previousClose: row.price,
      basePrice: row.price,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    positions.push({
      instrumentId: id,
      quantity: row.quantity,
      averageCost: row.averageCost,
      realizedIncome: 0,
      realizedPnL: 0,
    });
  }

  return { instruments, positions };
}
