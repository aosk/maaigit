// Types for core.mjs (used by maai's tests; the bot itself runs as plain JavaScript).
export interface Command { commandId: string; symbol: string; side: 'buy' | 'sell'; qty: number; limitPrice: number; issuedAt: string; expiresAt: string; sig: string }
export interface Result { status: 'filled' | 'partial' | 'rejected' | 'failed'; filledQty?: number; avgPrice?: number; brokerOrderId?: string; error?: string; screenshot?: string }
export interface Shown { symbol: string; side: string; qty: number; limitPrice: number }
export interface Broker {
  practice?: boolean;
  name?: string;
  session(): Promise<{ loggedIn: boolean; expiresInSec?: number }>;
  quotes(): Promise<{ symbol: string; price: number; prevClose?: number }[]>;
  account(): Promise<{ cash: number; positions: { symbol: string; qty: number; avgCost: number }[] } | null>;
  place(cmd: Command, tools: { beforeSubmit: () => Promise<boolean>; sameOrder: (shown: Shown) => boolean; progress: (stage: string) => Promise<void> }): Promise<Result>;
}
export interface Ledger { has(id: string): boolean; get(id: string): Record<string, unknown> | undefined; write(id: string, change: Record<string, unknown>): Record<string, unknown>; close(): void }
export const DEAD_MAN_MS: number;
export function signature(cmd: Omit<Command, 'sig'>, secret: string): string;
export function verify(cmd: unknown, secret: string, nowMs: number): string;
export function sameOrder(cmd: Command, shown: Shown): boolean;
export function createBot(o: { url: string; key: string; secret: string; broker: Broker; ledger: Ledger; log?: (s: string) => void; fetchImpl?: typeof fetch; now?: () => number }): {
  run(): Promise<string | undefined>;
  stop(reason?: string): void;
  handle(cmd: unknown): Promise<void>;
  recover(): Promise<void>;
  heartbeat(): Promise<void>;
  positions(): Promise<void>;
  state(): { lastOk: number; halted: boolean; mode: string; deadMan: boolean; clockOffset: number };
  idle(): Promise<void>;
};
