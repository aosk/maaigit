import type { Order, OrderSide, Position } from '../../../shared/src/types.js';
import type { AppState } from '../store/state.js';
import { MAX_ORDERS } from '../store/state.js';
import { snapshot } from './portfolio.js';

export class TradeError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'TradeError';
  }
}

export interface TradeRequest {
  instrumentId: string;
  side: OrderSide;
  quantity: number;
}

function findPosition(state: AppState, instrumentId: string): Position {
  let position = state.positions.find((p) => p.instrumentId === instrumentId);
  if (!position) {
    position = { instrumentId, quantity: 0, averageCost: 0, realizedIncome: 0, realizedPnL: 0 };
    state.positions.push(position);
  }
  return position;
}

/**
 * Executes a market order at the instrument's current price, after checking
 * every control the user set for that stock type: trading must be enabled,
 * cash must cover a buy, shares must exist for a sell, and the resulting
 * position must stay inside the type's single-position cap.
 */
export function placeOrder(state: AppState, request: TradeRequest): Order {
  const quantity = Math.floor(Number(request.quantity));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new TradeError('Quantity must be a positive whole number of shares.', 'BAD_QUANTITY');
  }

  const instrument = state.instruments.find((i) => i.id === request.instrumentId);
  if (!instrument) throw new TradeError('Unknown instrument.', 'NOT_FOUND');
  if (!instrument.active) {
    throw new TradeError(`${instrument.symbol} is inactive and cannot be traded.`, 'INACTIVE');
  }

  const controls = state.controls[instrument.type];
  if (!controls.tradingEnabled) {
    throw new TradeError(
      `Trading is switched off for ${instrument.type.replace('_', ' ').toLowerCase()} on the control page.`,
      'TRADING_DISABLED',
    );
  }

  const price = instrument.price;
  const notional = quantity * price;
  const position = findPosition(state, instrument.id);

  if (request.side === 'BUY') {
    if (notional > state.cash) {
      throw new TradeError(
        `Order needs ${notional.toFixed(2)} but only ${state.cash.toFixed(2)} cash is available.`,
        'INSUFFICIENT_CASH',
      );
    }

    const before = snapshot(state);
    const newValue = (position.quantity + quantity) * price;
    // Total value is unchanged by a buy: cash converts into position value.
    const weight = before.totalValue === 0 ? 0 : newValue / before.totalValue;
    if (controls.maxPositionPct > 0 && weight > controls.maxPositionPct) {
      throw new TradeError(
        `That buy would put ${instrument.symbol} at ${(weight * 100).toFixed(1)}% of the portfolio, over the ${(controls.maxPositionPct * 100).toFixed(0)}% cap for this type.`,
        'POSITION_LIMIT',
      );
    }

    const totalCost = position.quantity * position.averageCost + notional;
    position.quantity += quantity;
    position.averageCost = totalCost / position.quantity;
    state.cash -= notional;
  } else {
    if (quantity > position.quantity) {
      throw new TradeError(
        `Cannot sell ${quantity} shares of ${instrument.symbol}; the position holds ${position.quantity}.`,
        'INSUFFICIENT_SHARES',
      );
    }
    position.realizedPnL += (price - position.averageCost) * quantity;
    position.quantity -= quantity;
    if (position.quantity === 0) position.averageCost = 0;
    state.cash += notional;
  }

  const order: Order = {
    id: `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    instrumentId: instrument.id,
    symbol: instrument.symbol,
    type: instrument.type,
    side: request.side,
    quantity,
    price,
    notional,
    createdAt: new Date(state.simTime).toISOString(),
  };

  state.orders.unshift(order);
  if (state.orders.length > MAX_ORDERS) state.orders.length = MAX_ORDERS;
  return order;
}
