import 'dotenv/config';

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value && Number.isFinite(n) ? n : fallback;
};

export const config = {
  port: num(process.env.PORT, 5173),
  /** HTTPS port for phones on the same Wi-Fi (npm run phone). */
  phonePort: num(process.env.MAAI_PHONE_PORT, num(process.env.PORT, 5173) + 1),
  production: process.env.NODE_ENV === 'production',
  latitude: num(process.env.MAAI_LATITUDE, 24.7136),
  longitude: num(process.env.MAAI_LONGITUDE, 46.6753),
  timezone: process.env.MAAI_TIMEZONE || 'Asia/Riyadh',
};
