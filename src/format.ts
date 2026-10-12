import type { Lang } from '../shared/types';

// Arabic uses Arabic-Indic digits and the Umm al-Qura calendar for the Hijri date.
const locale = (lang: Lang) => (lang === 'ar' ? 'ar-SA-u-nu-arab' : 'en-GB');

export const time = (iso: string | Date, lang: Lang) =>
  new Intl.DateTimeFormat(locale(lang), { hour: 'numeric', minute: '2-digit', hour12: false }).format(new Date(iso));

export const dayTime = (iso: string | Date, lang: Lang) =>
  new Intl.DateTimeFormat(locale(lang), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: false }).format(new Date(iso));

export const dayHeading = (iso: string | Date, lang: Lang) =>
  new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-arab' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));

export const hijri = (iso: string | Date, lang: Lang) =>
  new Intl.DateTimeFormat(`${lang === 'ar' ? 'ar-SA' : 'en'}-u-ca-islamic-umalqura${lang === 'ar' ? '-nu-arab' : ''}`, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

export const num = (n: number, lang: Lang) => new Intl.NumberFormat(locale(lang)).format(n);

export const sameDay = (a: string | Date, b: string | Date) => new Date(a).toDateString() === new Date(b).toDateString();
