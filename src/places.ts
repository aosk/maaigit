/** Cities to pick from in Settings → «موقعك». Each has its position (for prayer times) and its time zone. */
export interface City {
  ar: string;
  en: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export const CITIES: City[] = [
  { ar: 'الرياض', en: 'Riyadh', latitude: 24.7136, longitude: 46.6753, timezone: 'Asia/Riyadh' },
  { ar: 'جدة', en: 'Jeddah', latitude: 21.4858, longitude: 39.1925, timezone: 'Asia/Riyadh' },
  { ar: 'مكة المكرمة', en: 'Makkah', latitude: 21.3891, longitude: 39.8579, timezone: 'Asia/Riyadh' },
  { ar: 'المدينة المنورة', en: 'Madinah', latitude: 24.5247, longitude: 39.5692, timezone: 'Asia/Riyadh' },
  { ar: 'الدمام', en: 'Dammam', latitude: 26.4207, longitude: 50.0888, timezone: 'Asia/Riyadh' },
  { ar: 'الخبر', en: 'Khobar', latitude: 26.2172, longitude: 50.1971, timezone: 'Asia/Riyadh' },
  { ar: 'الطائف', en: 'Taif', latitude: 21.2703, longitude: 40.4158, timezone: 'Asia/Riyadh' },
  { ar: 'أبها', en: 'Abha', latitude: 18.2164, longitude: 42.5053, timezone: 'Asia/Riyadh' },
  { ar: 'تبوك', en: 'Tabuk', latitude: 28.3838, longitude: 36.555, timezone: 'Asia/Riyadh' },
  { ar: 'بريدة', en: 'Buraydah', latitude: 26.326, longitude: 43.975, timezone: 'Asia/Riyadh' },
  { ar: 'حائل', en: 'Hail', latitude: 27.5114, longitude: 41.7208, timezone: 'Asia/Riyadh' },
  { ar: 'جازان', en: 'Jazan', latitude: 16.8892, longitude: 42.5511, timezone: 'Asia/Riyadh' },
  { ar: 'نجران', en: 'Najran', latitude: 17.4924, longitude: 44.1277, timezone: 'Asia/Riyadh' },
  { ar: 'الأحساء', en: 'Al-Ahsa', latitude: 25.3833, longitude: 49.5861, timezone: 'Asia/Riyadh' },
  { ar: 'دبي', en: 'Dubai', latitude: 25.2048, longitude: 55.2708, timezone: 'Asia/Dubai' },
  { ar: 'أبوظبي', en: 'Abu Dhabi', latitude: 24.4539, longitude: 54.3773, timezone: 'Asia/Dubai' },
  { ar: 'الدوحة', en: 'Doha', latitude: 25.2854, longitude: 51.531, timezone: 'Asia/Qatar' },
  { ar: 'المنامة', en: 'Manama', latitude: 26.2285, longitude: 50.586, timezone: 'Asia/Bahrain' },
  { ar: 'الكويت', en: 'Kuwait City', latitude: 29.3759, longitude: 47.9774, timezone: 'Asia/Kuwait' },
  { ar: 'مسقط', en: 'Muscat', latitude: 23.588, longitude: 58.3829, timezone: 'Asia/Muscat' },
  { ar: 'القاهرة', en: 'Cairo', latitude: 30.0444, longitude: 31.2357, timezone: 'Africa/Cairo' },
  { ar: 'عمّان', en: 'Amman', latitude: 31.9454, longitude: 35.9284, timezone: 'Asia/Amman' },
  { ar: 'إسطنبول', en: 'Istanbul', latitude: 41.0082, longitude: 28.9784, timezone: 'Europe/Istanbul' },
  { ar: 'لندن', en: 'London', latitude: 51.5074, longitude: -0.1278, timezone: 'Europe/London' },
  { ar: 'باريس', en: 'Paris', latitude: 48.8566, longitude: 2.3522, timezone: 'Europe/Paris' },
  { ar: 'نيويورك', en: 'New York', latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York' },
  { ar: 'كوالالمبور', en: 'Kuala Lumpur', latitude: 3.139, longitude: 101.6869, timezone: 'Asia/Kuala_Lumpur' },
];

/** The city in the list nearest a position, when it is within about 60 km (to name "my location"). */
export function nearestCity(latitude: number, longitude: number): City | null {
  let best: City | null = null;
  let bestKm = 60;
  for (const c of CITIES) {
    const dLat = (c.latitude - latitude) * 111;
    const dLon = (c.longitude - longitude) * 111 * Math.cos((latitude * Math.PI) / 180);
    const km = Math.hypot(dLat, dLon);
    if (km < bestKm) {
      best = c;
      bestKm = km;
    }
  }
  return best;
}
