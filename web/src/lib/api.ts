import type {
  Alert,
  AssetType,
  EngineSettings,
  HistoryPoint,
  Instrument,
  Order,
  OrderSide,
  PortfolioSnapshot,
  TypeControls,
} from '../../../shared/src/types.js';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json', ...init?.headers } : init?.headers,
    });
  } catch {
    throw new ApiError('Cannot reach the StockPlay server.', 'OFFLINE');
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string; code?: string } }
      | null;
    throw new ApiError(
      body?.error?.message ?? `Request failed (${response.status}).`,
      body?.error?.code ?? 'HTTP_ERROR',
    );
  }
  return (await response.json()) as T;
}

export interface NewInstrument {
  symbol: string;
  name: string;
  type: AssetType;
  exchange: string;
  sector: string;
  price: number;
}

export const api = {
  portfolio: () => request<PortfolioSnapshot>('/portfolio'),
  history: (points = 240) => request<HistoryPoint[]>(`/history?points=${points}`),
  instruments: () => request<Instrument[]>('/instruments'),
  orders: (limit = 25) => request<Order[]>(`/orders?limit=${limit}`),
  controls: () => request<TypeControls[]>('/controls'),
  engine: () => request<EngineSettings>('/engine'),
  alerts: () => request<Alert[]>('/alerts'),

  addInstrument: (body: NewInstrument) =>
    request<Instrument>('/instruments', { method: 'POST', body: JSON.stringify(body) }),
  updateInstrument: (id: string, body: Partial<Instrument>) =>
    request<Instrument>(`/instruments/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeInstrument: (id: string) =>
    request<{ removed: string }>(`/instruments/${id}`, { method: 'DELETE' }),

  placeOrder: (body: { instrumentId: string; side: OrderSide; quantity: number }) =>
    request<{ order: Order; portfolio: PortfolioSnapshot }>('/orders', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateControls: (type: AssetType, body: Partial<TypeControls>) =>
    request<TypeControls>(`/controls/${type}`, { method: 'PATCH', body: JSON.stringify(body) }),
  updateEngine: (body: Partial<EngineSettings>) =>
    request<EngineSettings>('/engine', { method: 'PATCH', body: JSON.stringify(body) }),

  ackAlert: (id: string) => request<Alert>(`/alerts/${id}/ack`, { method: 'POST' }),
  ackAllAlerts: () => request<{ cleared: number }>('/alerts/ack-all', { method: 'POST' }),
};
