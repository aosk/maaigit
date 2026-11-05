/**
 * Past disclosures the decision agent may use as background: company results, deals and the central bank's rate
 * decisions from the last months, for the stocks StockSmart trades. Each one was checked against the issuer's or the
 * regulator's own release (or several independent outlets reporting it) on 5 November 2026; only figures that matched
 * are kept, and anything that could not be confirmed was left out. Market wraps and daily price moves are not here:
 * they describe what happened after the news, and the agent must not learn from hindsight.
 *
 * They are context, never news: each becomes visible only from the day after it was published (the conservative
 * assumption when the exact hour is unknown), and only for 120 days.
 */

export interface ReferenceEvent {
  /** The day the company or regulator published it (Riyadh). */
  date: string;
  /** Stocks it concerns; empty means the whole market. */
  symbols: string[];
  headline: string;
  /** Checked figures, in short Arabic phrases. */
  facts: string[];
  source: string;
}

export const REFERENCE: ReferenceEvent[] = [
  {
    date: '2026-08-18',
    symbols: ['2222', '1211'],
    headline: 'أرامكو ومعادن توقّعان اتفاقية مساهمين لمشروع مشترك للاستكشاف المعدني',
    facts: ['ملكية معادن ٥١٪ وأرامكو ٤٩٪', 'استكشاف النحاس والزنك والرصاص في المنطقة الانتقالية', 'مشروط بموافقات تنظيمية ولم يُستكمل بعد، بدون التزام رأسمالي معلن'],
    source: 'https://www.aramco.com/en/news-media/news/2026/aramco-and-maaden-sign-shareholders-agreement',
  },
  {
    date: '2026-08-24',
    symbols: ['2222'],
    headline: 'أرامكو توقّع اتفاقيات ومذكرة تفاهم مع شركات فرنسية',
    facts: ['قيمة محتملة إجمالية تتجاوز ٣٫٧ مليار دولار', 'شراء معدات حفر وأنابيب تغليف، ومذكرة تفاهم لأرامكو الرقمية في الذكاء الاصطناعي الصناعي', 'قيمة محتملة وليست إيرادات محققة'],
    source: 'https://www.aramco.com/en/news-media/news/2026/aramco-enhances-its-global-partnership-ecosystem-through-collaboration-with-french-companies',
  },
  {
    date: '2026-09-16',
    symbols: [],
    headline: 'البنك المركزي السعودي يرفع أسعار الفائدة ٢٥ نقطة أساس بعد رفع الفيدرالي',
    facts: ['الريبو من ٤٫٢٥٪ إلى ٤٫٥٠٪', 'الريبو العكسي من ٣٫٧٥٪ إلى ٤٫٠٠٪'],
    source: 'https://www.spa.gov.sa/en/N2678377',
  },
  {
    date: '2026-10-21',
    symbols: ['1120'],
    headline: 'مصرف الراجحي: نمو أرباح الأشهر التسعة',
    facts: ['صافي ربح ٩ أشهر ٢٠٫٨٧ مليار ريال (+١٣٪ سنوياً)', 'ربح الربع الثالث ٧٫١٠ مليار ريال (+١١٫٧٪ سنوياً)'],
    source: 'https://www.decypha.com/en/news/details/Al-Rajhi-Bank-s-total-assets-hit-SAR-1trn-in-9M-26--profits-jump-13-5-/21581647?L=EN',
  },
  {
    date: '2026-10-21',
    symbols: ['1180'],
    headline: 'البنك الأهلي السعودي: نمو أرباح الأشهر التسعة وربع ثالث مستقر',
    facts: ['صافي ربح ٩ أشهر ١٩٫٤٨ مليار ريال (+٤٫٦٪)', 'ربح الربع الثالث ٦٫٤٥ مليار ريال (-٠٫٣٪ سنوياً، -٢٫٤٪ عن الربع الثاني)'],
    source: 'https://www.decypha.com/en/news/details/SNB-logs-SAR-19-5bn-profits-in-9M-26-results/21581683?L=EN',
  },
  {
    date: '2026-10-25',
    symbols: ['2010'],
    headline: 'سابك: تحسّن فصلي وعودة للربح في الربع الثالث',
    facts: ['إيرادات ٢٨٫١٧ مليار ريال (+١٤٪ عن الربع الثاني، -٣٪ سنوياً)', 'EBITDA معدّلة ٤٫٧٥ مليار ريال (+٤٠٪ فصلياً)', 'صافي ربح معدّل نحو ٠٫٨٤ مليار مقابل خسارة معدّلة ٠٫٣٨ مليار في الربع الثاني', 'الربح المعلن ٠٫٥ مليار ويتضمن بنداً غير متكرر'],
    source: 'https://www.thenationalnews.com/business/energy/2026/10/25/sabic-returns-to-profit-in-third-quarter-as-revenue-rises-despite-regional-conflict/',
  },
  {
    date: '2026-10-28',
    symbols: ['7010'],
    headline: 'stc: نتائج الأشهر التسعة وتوزيع الربع الثالث',
    facts: ['إيرادات ٩ أشهر ٦٠٬٠٩٦ مليون ريال (+٣٫٧٪)', 'ربح تشغيلي ١١٬٢٨٢ مليون (+٤٫١٪)', 'صافي ربح ١٠٬٩١٨ مليون (-٥٫٧٪ معلن، +٢٫٦٪ بدون البنود غير المتكررة)', 'توزيع ٠٫٥٥ ريال للسهم عن الربع الثالث'],
    source: 'https://maaal.com/en/news/details/stc-groups-nine-month-op/',
  },
  {
    date: '2026-11-01',
    symbols: ['2222'],
    headline: 'أرامكو وصندوق الاستثمارات العامة يستكملان صفقة هيوماين',
    facts: ['حصة أرامكو ٤٩٪ والصندوق ٥١٪', 'مساهمة نقدية نحو ٩٫٩ مليار ريال (٢٫٦ مليار دولار) خلال ٢٠٢٦ مع أصول ذكاء اصطناعي', 'استثمار طويل الأجل وليس ربحاً حالياً'],
    source: 'https://www.aramco.com/en/news-media/news/2026/pif-and-aramco-close-humain-transaction-to-accelerate-humains-global-growth',
  },
  {
    date: '2026-11-03',
    symbols: ['2222'],
    headline: 'أرامكو: نتائج الربع الثالث وتوزيع أساسي',
    facts: ['صافي دخل معدّل ٣١٫٢ مليار دولار (+٩٪ سنوياً)', 'صافي الدخل المعلن ٣٦٫٢٥ مليار دولار', 'توزيع أساسي ٢١٫٩ مليار دولار (الاستحقاق ١٦ نوفمبر، الصرف ٢٥ نوفمبر)', 'تدفق نقدي حر ٢٨٫٢ مليار دولار'],
    source: 'https://www.cnbc.com/2026/11/03/saudi-aramcos-third-quarter-middle-east-.html',
  },
];

const DAY_MS = 86_400_000;
/** How long a disclosure stays useful background. */
const KEEP_DAYS = 120;

/**
 * The disclosures known by `now` for these stocks (and the market-wide ones), newest first: visible from midnight
 * Riyadh after the publication day, and for KEEP_DAYS after it.
 */
export function referenceFor(symbols: string[], now: Date, list: ReferenceEvent[] = REFERENCE): ReferenceEvent[] {
  const wanted = new Set(symbols);
  return list
    .filter((e) => {
      const visibleFrom = Date.parse(`${e.date}T00:00:00+03:00`) + DAY_MS;
      return now.getTime() >= visibleFrom && now.getTime() - visibleFrom <= KEEP_DAYS * DAY_MS && (e.symbols.length === 0 || e.symbols.some((s) => wanted.has(s)));
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
