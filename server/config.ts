import 'dotenv/config';
import path from 'node:path';

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value && Number.isFinite(n) ? n : fallback;
};

/** Where MAAI keeps its data: the store, push keys, phone certificate. Online, a persistent disk. */
const dataDir = path.resolve(process.env.MAAI_DATA_DIR || 'data');

const timezone = process.env.MAAI_TIMEZONE || 'Asia/Riyadh';
// Reminder and prayer times use the server's local clock; online servers run on UTC, so pin it.
process.env.TZ ||= timezone;

// Libraries (Express among them) behave more safely, and say less, when NODE_ENV is production.
const production = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true' || process.argv.includes('--online');
if (production) process.env.NODE_ENV ??= 'production';

export const config = {
  dataDir,
  port: num(process.env.PORT, 5173),
  /** HTTPS port for phones on the same Wi-Fi (npm run phone). */
  phonePort: num(process.env.MAAI_PHONE_PORT, num(process.env.PORT, 5173) + 1),
  /** Online mode: password, all network interfaces, built files. Render sets RENDER=true on its servers. */
  production,
  latitude: num(process.env.MAAI_LATITUDE, 24.7136),
  longitude: num(process.env.MAAI_LONGITUDE, 46.6753),
  timezone,
  /** How often everything (calendars, Asana, mail) is refreshed in the background. */
  syncHours: Math.max(0.25, num(process.env.MAAI_SYNC_HOURS, 3)),
  /** How often your Google calendar is read live (seconds). */
  liveSeconds: Math.max(2, num(process.env.MAAI_LIVE_SECONDS, 60)),
  /** Days WhatsApp messages received on the business number are kept. */
  whatsappDays: Math.max(1, Math.min(90, Math.round(num(process.env.MAAI_WHATSAPP_DAYS, 7)))),
  /** Once Face ID is set up: minutes of not using MAAI before it asks for Face ID again. */
  lockMinutes: Math.max(1, Math.min(1440, num(process.env.MAAI_LOCK_MINUTES, 5))),
  /** Required online: the password that protects MAAI. */
  password: process.env.MAAI_PASSWORD ?? '',
};
