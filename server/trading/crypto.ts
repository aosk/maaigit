import type { Instrument, MarketClock } from '../../shared/trading.js';

/**
 * The crypto desk's market: it never closes. Days (for the daily order count and the daily loss limit) start at
 * midnight Riyadh. Coins are bought in fractions (down to a millionth), priced in US dollars.
 *
 * The list (chosen 2026-11-09): the largest, most liquid coins, leaving out lending and yield tokens (interest),
 * meme coins and exchange tokens. Whether crypto is permissible is debated among scholars and no Shariah board
 * certifies these the way it does an ETF: ask a scholar you trust. Not financial advice.
 */

export const cryptoClock = (): MarketClock => ({ open: true, minutesToChange: 24 * 60, label: 'open' });

export const CRYPTO_UNIVERSE: Instrument[] = [
  { symbol: 'BTC', nameAr: 'بيتكوين', nameEn: 'Bitcoin', sector: 'bitcoin' },
  { symbol: 'ETH', nameAr: 'إيثيريوم', nameEn: 'Ethereum', sector: 'layer1' },
  { symbol: 'SOL', nameAr: 'سولانا', nameEn: 'Solana', sector: 'layer1' },
  { symbol: 'XRP', nameAr: 'إكس آر بي', nameEn: 'XRP', sector: 'payments' },
  { symbol: 'ADA', nameAr: 'كاردانو', nameEn: 'Cardano', sector: 'layer1' },
  { symbol: 'AVAX', nameAr: 'أفالانش', nameEn: 'Avalanche', sector: 'layer1' },
  { symbol: 'LINK', nameAr: 'تشين لينك', nameEn: 'Chainlink', sector: 'infrastructure' },
  { symbol: 'LTC', nameAr: 'لايتكوين', nameEn: 'Litecoin', sector: 'payments' },
];

/** Simulated starting prices (development and tests only), in dollars. */
export const CRYPTO_SIM_BASE: Record<string, number> = { BTC: 100_000, ETH: 3_500, SOL: 180, XRP: 2.4, ADA: 0.75, AVAX: 30, LINK: 18, LTC: 95 };
