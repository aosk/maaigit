import fs from 'node:fs';
import os from 'node:os';
import type { Gauge, HealthCheck, RenderService, RenderUsage, UsageLevel } from '../shared/types.js';
import { config } from './config.js';

/**
 * Render, where MAAI runs: what it costs a month and how hard this server is working.
 *
 * Two sources. The machine itself (memory, CPU and disk, read from the container: always available, no key), sampled
 * every minute so the admin portal can draw the last hour. And Render's own API (RENDER_API_KEY): every service in the
 * workspace with its plan, so the monthly cost can be worked out, and this service's CPU, memory, bandwidth and errors
 * over the last day and month. Render's API has no invoice or balance, so the cost is an estimate from the published
 * prices: the real bill is in the Render dashboard → Billing.
 */

const API = (process.env.RENDER_API_BASE ?? 'https://api.render.com/v1').replace(/\/+$/, '');
const key = () => process.env.RENDER_API_KEY?.trim() ?? '';
const renderConfigured = () => Boolean(key());

const CACHE_MS = 5 * 60_000;
const DAY = 86_400_000;

/** Render's published monthly prices (US$) for an instance type, by its plan name or its size. */
const PLANS: Record<string, { label: string; usd: number }> = {
  free: { label: 'Free', usd: 0 },
  starter: { label: 'Starter', usd: 7 },
  '0.5c-512mb': { label: 'Starter', usd: 7 },
  standard: { label: 'Standard', usd: 25 },
  '1c-2gb': { label: 'Standard', usd: 25 },
  pro: { label: 'Pro', usd: 85 },
  '2c-4gb': { label: 'Pro', usd: 85 },
  pro_plus: { label: 'Pro Plus', usd: 175 },
  '4c-8gb': { label: 'Pro Plus', usd: 175 },
  pro_max: { label: 'Pro Max', usd: 225 },
  '4c-16gb': { label: 'Pro Max', usd: 225 },
  pro_ultra: { label: 'Pro Ultra', usd: 450 },
  '8c-32gb': { label: 'Pro Ultra', usd: 450 },
};
/** Persistent disk, per GB a month: charged even while the service is suspended. */
const DISK_USD_PER_GB = 0.25;
/** Outbound bandwidth Render includes each month (the smallest workspace plan); above it is charged. */
const INCLUDED_BANDWIDTH_MB = 100 * 1024;

/** Low, medium or high against two thresholds (a share in %, or any amount). */
export const levelOf = (value: number, medium: number, high: number): UsageLevel => (value >= high ? 'high' : value >= medium ? 'medium' : 'low');

/** The thresholds for each kind of use, in one place, so the portal and the health checks agree. */
const THRESHOLDS = {
  memoryPct: [60, 85],
  cpuPct: [50, 80],
  diskPct: [60, 85],
  bandwidthPct: [50, 80],
  errorPct: [1, 5],
  monthlyUsd: [20, 50],
} as const satisfies Record<string, readonly [number, number]>;

const level = (kind: keyof typeof THRESHOLDS, value: number) => levelOf(value, THRESHOLDS[kind][0], THRESHOLDS[kind][1]);
const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------- The machine itself ----------

const readNumber = (file: string): number | undefined => {
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    const n = Number(text);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
};

/** The container's memory limit in bytes (cgroup v2, then v1), or the machine's when it has none. */
function memoryLimit(): number {
  try {
    const v2 = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    if (v2 !== 'max' && Number(v2) > 0) return Number(v2);
  } catch {
    // not cgroup v2
  }
  const v1 = readNumber('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  if (v1 && v1 < 2 ** 60) return v1;
  const planned = Number(process.env.MAAI_MEMORY_MB);
  return planned > 0 ? planned * 2 ** 20 : os.totalmem();
}

/** The container's memory in use: what the host counts against the limit. */
function memoryUsed(): number {
  return readNumber('/sys/fs/cgroup/memory.current') ?? readNumber('/sys/fs/cgroup/memory/memory.usage_in_bytes') ?? process.memoryUsage().rss;
}

/** How many CPUs the container may use (cpu.max "50000 100000" is half a CPU). */
function cpuLimit(): number {
  try {
    const [quota, period] = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/);
    if (quota !== 'max' && Number(quota) > 0 && Number(period) > 0) return Number(quota) / Number(period);
  } catch {
    // not cgroup v2
  }
  const quota = readNumber('/sys/fs/cgroup/cpu/cpu.cfs_quota_us');
  const period = readNumber('/sys/fs/cgroup/cpu/cpu.cfs_period_us');
  if (quota && quota > 0 && period) return quota / period;
  return os.cpus().length || 1;
}

interface Sample {
  at: number;
  memory: number;
  /** CPUs used on average since the previous sample. */
  cpu: number;
}

/** The last hour, a sample a minute. */
const samples: Sample[] = [];
let lastCpu = process.cpuUsage();
let lastAt = Date.now();

function sample(now = Date.now()): Sample {
  const cpu = process.cpuUsage();
  const usedMicros = cpu.user - lastCpu.user + (cpu.system - lastCpu.system);
  const elapsed = Math.max(1, now - lastAt);
  lastCpu = cpu;
  lastAt = now;
  const s = { at: now, memory: memoryUsed(), cpu: usedMicros / 1000 / elapsed };
  samples.push(s);
  if (samples.length > 60) samples.splice(0, samples.length - 60);
  return s;
}

let sampler: NodeJS.Timeout | undefined;
/**
 * Starts the minute-by-minute sampling of this machine (once), and, with a key, reads Render every 30 minutes so the
 * health checks know the cost and the error rate without waiting for the admin portal to be opened.
 */
export function startRenderWatch(): void {
  if (sampler) return;
  sample();
  sampler = setInterval(() => sample(), 60_000);
  sampler.unref?.();
  if (!renderConfigured()) return;
  const read = () => void renderUsage({ force: true }).catch(() => {});
  setTimeout(read, 20_000).unref?.();
  setInterval(read, 30 * 60_000).unref?.();
}

function diskGauge(): Gauge | undefined {
  try {
    const s = fs.statfsSync(config.dataDir);
    const size = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    if (!size) return undefined;
    const used = size - free;
    const pct = round1((used / size) * 100);
    // A big disk with gigabytes still free is not short of room, whatever the share.
    const roomy = free > 5 * 2 ** 30;
    return { used: round1(used / 2 ** 20), limit: round1(size / 2 ** 20), pct, level: roomy ? 'low' : level('diskPct', pct), unit: 'MB' };
  } catch {
    return undefined;
  }
}

/** This machine right now, with the last hour of samples. */
export function localUsage(): RenderUsage['local'] {
  const now = samples.length ? samples[samples.length - 1] : sample();
  const memLimit = memoryLimit();
  const memPct = round1((now.memory / memLimit) * 100);
  const cpus = cpuLimit();
  const cpuPct = round1((Math.max(...samples.map((s) => s.cpu), now.cpu) / cpus) * 100);
  return {
    memory: { used: round1(now.memory / 2 ** 20), limit: round1(memLimit / 2 ** 20), pct: memPct, level: level('memoryPct', memPct), unit: 'MB', series: samples.map((s) => round1(s.memory / 2 ** 20)) },
    cpu: { used: round1(now.cpu), limit: cpus, pct: cpuPct, level: level('cpuPct', cpuPct), unit: 'CPU', series: samples.map((s) => round1((s.cpu / cpus) * 100)) },
    disk: diskGauge(),
    uptimeSec: Math.round(process.uptime()),
    node: process.version,
  };
}

// ---------- Render's API ----------

class RenderError extends Error {}

async function get<T>(path: string, params: Record<string, string> = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetcher(url, { headers: { Authorization: `Bearer ${key()}`, Accept: 'application/json', 'User-Agent': 'MAAI/1.0' }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new RenderError('Could not reach Render.');
  }
  if (res.status === 401 || res.status === 403) throw new RenderError('Render refused the key: check RENDER_API_KEY (Render → Account settings → API keys).');
  if (!res.ok) throw new RenderError(`Render answered ${res.status}.`);
  return (await res.json()) as T;
}

interface ApiService {
  id: string;
  name: string;
  type: string;
  suspended?: string;
  dashboardUrl?: string;
  serviceDetails?: { plan?: string; url?: string; disk?: { sizeGB?: number } };
}

/** What one service costs a month: its instance (not while suspended, nothing for a static site) and its disk. */
export function costOf(s: ApiService, self = false): RenderService {
  const suspended = s.suspended === 'suspended';
  const plan = s.serviceDetails?.plan;
  const known = plan ? PLANS[plan] : undefined;
  const diskGB = s.serviceDetails?.disk?.sizeGB;
  const diskUsd = diskGB ? diskGB * DISK_USD_PER_GB : 0;
  const staticSite = s.type === 'static_site';
  const usageBased = s.type === 'cron_job';
  const computeUsd = staticSite || suspended ? 0 : known?.usd;
  const note = staticSite ? 'Static sites are free' : usageBased ? 'Billed by the minute it runs' : suspended ? (diskUsd ? 'Suspended: only the disk is charged' : 'Suspended: not charged') : known ? undefined : `Unknown plan "${plan ?? '?'}": not counted`;
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    plan: staticSite ? 'Static' : known?.label ?? plan ?? '—',
    suspended,
    diskGB,
    computeUsd: computeUsd ?? 0,
    diskUsd,
    monthlyUsd: (computeUsd ?? 0) + diskUsd,
    url: s.serviceDetails?.url,
    dashboardUrl: s.dashboardUrl,
    self,
    note,
  };
}

interface MetricSeries {
  labels?: { field: string; value: string }[];
  unit?: string;
  values?: { timestamp: string; value: number }[];
}

const points = (series: MetricSeries[]) => series.flatMap((s) => s.values ?? []);
/** One value per time step across all the series (instances, status codes): summed or the highest. */
function merge(series: MetricSeries[], how: 'sum' | 'max'): number[] {
  const byTime = new Map<string, number>();
  for (const p of points(series)) byTime.set(p.timestamp, how === 'sum' ? (byTime.get(p.timestamp) ?? 0) + p.value : Math.max(byTime.get(p.timestamp) ?? 0, p.value));
  return [...byTime.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
}

/** This service's own numbers from Render, each read on its own so one missing metric does not hide the rest. */
async function selfMetrics(id: string, now: number, fetcher: typeof fetch): Promise<NonNullable<RenderUsage['self']>> {
  const day = { resource: id, startTime: new Date(now - DAY).toISOString(), endTime: new Date(now).toISOString(), resolutionSeconds: '3600' };
  const month = { resource: id, startTime: new Date(now - 30 * DAY).toISOString(), endTime: new Date(now).toISOString(), resolutionSeconds: String(DAY / 1000) };
  const read = (path: string, params: Record<string, string>) => get<MetricSeries[]>(path, params, fetcher).catch(() => null);
  const [cpu, cpuLim, mem, memLim, bandwidth, requests] = await Promise.all([
    read('/metrics/cpu', day),
    read('/metrics/cpu-limit', day),
    read('/metrics/memory', day),
    read('/metrics/memory-limit', day),
    read('/metrics/bandwidth', month),
    read('/metrics/http-requests', { ...day, aggregateBy: 'statusCode' }),
  ]);
  const out: NonNullable<RenderUsage['self']> = {};
  const limitOf = (s: MetricSeries[] | null) => (s ? Math.max(0, ...points(s).map((p) => p.value)) : 0);
  if (cpu?.length) {
    const series = merge(cpu, 'max');
    const limit = limitOf(cpuLim) || cpuLimit();
    const pct = round1((Math.max(...series) / limit) * 100);
    out.cpu = { used: round1(series[series.length - 1] ?? 0), limit, pct, level: level('cpuPct', pct), unit: 'CPU', series: series.map((v) => round1((v / limit) * 100)) };
  }
  if (mem?.length) {
    const series = merge(mem, 'max');
    const limit = limitOf(memLim) || memoryLimit();
    const pct = round1((Math.max(...series) / limit) * 100);
    out.memory = { used: round1((series[series.length - 1] ?? 0) / 2 ** 20), limit: round1(limit / 2 ** 20), pct, level: level('memoryPct', pct), unit: 'MB', series: series.map((v) => round1(v / 2 ** 20)) };
  }
  if (bandwidth?.length) {
    const series = merge(bandwidth, 'sum');
    const last30MB = round1(series.reduce((a, v) => a + v, 0));
    // A month at the pace of the last week (recent use says more than an old spike).
    const week = series.slice(-7);
    const projectedMonthMB = round1((week.reduce((a, v) => a + v, 0) / Math.max(1, week.length)) * 30);
    const pct = (projectedMonthMB / INCLUDED_BANDWIDTH_MB) * 100;
    out.bandwidth = { last30MB, projectedMonthMB, includedMB: INCLUDED_BANDWIDTH_MB, level: level('bandwidthPct', pct), series: series.map(round1) };
  }
  if (requests?.length) {
    const isError = (s: MetricSeries) => Number(s.labels?.find((l) => l.field === 'statusCode')?.value) >= 500;
    const total24h = Math.round(points(requests).reduce((a, p) => a + p.value, 0));
    const errors24h = Math.round(points(requests.filter(isError)).reduce((a, p) => a + p.value, 0));
    const errorRate = total24h ? round1((errors24h / total24h) * 100) : 0;
    out.requests = { total24h, errors24h, errorRate, level: level('errorPct', errorRate), series: merge(requests, 'sum') };
  }
  return out;
}

let cache: { at: number; value: RenderUsage } | null = null;

/** Which of the services is this one: Render names it in RENDER_SERVICE_ID, or by the address it is served at. */
const isSelf = (s: ApiService) => s.id === process.env.RENDER_SERVICE_ID || (Boolean(process.env.RENDER_EXTERNAL_URL) && s.serviceDetails?.url === process.env.RENDER_EXTERNAL_URL);

export async function renderUsage({ force = false, now = Date.now(), fetcher = fetch }: { force?: boolean; now?: number; fetcher?: typeof fetch } = {}): Promise<RenderUsage> {
  const local = localUsage();
  const checkedAt = new Date(now).toISOString();
  if (!renderConfigured()) {
    return { checkedAt, local, reports: 'needs-key', message: 'Add RENDER_API_KEY in Render → Environment (create it in Render → Account settings → API keys) to see every service, the monthly cost, bandwidth and errors.' };
  }
  if (!force && cache && now - cache.at < CACHE_MS) return { ...cache.value, local };
  try {
    const rows = await get<{ service: ApiService }[]>('/services', { limit: '100' }, fetcher);
    const services = rows.map((r) => costOf(r.service, isSelf(r.service))).sort((a, b) => Number(b.self) - Number(a.self) || b.monthlyUsd - a.monthlyUsd || a.name.localeCompare(b.name));
    const usd = Math.round(services.reduce((a, s) => a + s.monthlyUsd, 0) * 100) / 100;
    const mine = services.find((s) => s.self);
    const value: RenderUsage = {
      checkedAt,
      local,
      reports: 'ok',
      services,
      monthly: {
        usd,
        level: level('monthlyUsd', usd),
        running: services.filter((s) => !s.suspended && s.monthlyUsd > 0).length,
        suspended: services.filter((s) => s.suspended).length,
        free: services.filter((s) => !s.suspended && s.monthlyUsd === 0).length,
        idleUsd: Math.round(services.filter((s) => s.suspended).reduce((a, s) => a + s.monthlyUsd, 0) * 100) / 100,
      },
      self: mine ? await selfMetrics(mine.id, now, fetcher) : undefined,
      message: mine ? undefined : 'This server could not be matched to a service (RENDER_SERVICE_ID), so only the costs are shown.',
    };
    cache = { at: now, value };
    return value;
  } catch (error) {
    return { checkedAt, local, reports: 'error', message: error instanceof RenderError ? error.message : 'Render could not be read.' };
  }
}

/** Forgets the cache (tests). */
export function resetRenderCache(): void {
  cache = null;
}

const money = (usd: number) => `$${usd.toFixed(usd < 10 ? 2 : 0)}`;

/** Render in the health checks: how it is read, what it costs, and whether this service is erroring. */
export function renderCheck(): HealthCheck {
  const name = 'Render hosting';
  if (!renderConfigured()) return { id: 'render', name, status: 'off', detail: 'Cost, bandwidth and errors from Render are not read.', fix: 'RENDER_API_KEY in Render → Environment (make one in Render → Account settings → API keys).' };
  const r = cache?.value;
  if (!r) return { id: 'render', name, status: 'ok', detail: 'Reading Render…' };
  if (r.reports === 'error') return { id: 'render', name, status: 'warn', detail: r.message ?? 'Render could not be read.' };
  const m = r.monthly!;
  const errors = r.self?.requests;
  const parts = [`About ${money(m.usd)} a month for ${m.running} paid service${m.running === 1 ? '' : 's'}${m.idleUsd ? ` (${money(m.idleUsd)} of it for disks of suspended ones)` : ''}`];
  if (errors) parts.push(`${errors.errorRate}% server errors in 24 h`);
  const bad = errors?.level === 'high' || m.level === 'high';
  return {
    id: 'render',
    name,
    status: bad ? 'warn' : 'ok',
    detail: `${parts.join('; ')}.`,
    fix: errors?.level === 'high' ? 'Many requests failed: most often a deploy restarting, or the server running out of memory.' : m.level === 'high' ? 'The monthly cost is high: suspend services you do not use.' : undefined,
  };
}

