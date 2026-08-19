/**
 * Intent and period detection.
 *
 * Deliberately deterministic, keyword-driven code rather than a model call.
 * Three reasons, in order of importance:
 *
 *  1. **It decides what data is fetched.** If a model chose the query plan, a
 *     crafted prompt could steer it; here the plan is a pure function of the
 *     question text and cannot reach outside the caller's own tenant no matter
 *     what the question says.
 *  2. It is testable and free — no network, no tokens, no timeout.
 *  3. It works identically when the AI provider is down, which is what keeps
 *     the assistant answering at all in that state.
 *
 * Uzbek Latin, Uzbek Cyrillic, Russian and English keywords are all matched so
 * a driver-turned-dispatcher typing in whichever language they think in gets
 * the same answer.
 */

export const AI_INTENTS = [
  'REVENUE',
  'EXPENSE',
  'PROFIT',
  'MARGIN',
  'TRIPS',
  'ROUTES',
  'VEHICLES',
  'DRIVERS',
  'FUEL',
  'DISTANCE',
  'MONTHLY_COMPARISON',
  'ANOMALY',
  'RECOMMENDATION',
] as const;
export type AiIntent = (typeof AI_INTENTS)[number];

export const AI_PERIOD_HINTS = [
  'THIS_MONTH',
  'LAST_MONTH',
  'LAST_30_DAYS',
  'LAST_90_DAYS',
  'THIS_YEAR',
  'NAMED_MONTH',
] as const;
export type AiPeriodHint = (typeof AI_PERIOD_HINTS)[number];

export interface DetectedIntent {
  intents: AiIntent[];
  period: AiPeriodHint;
  /** 0–11 when `period` is NAMED_MONTH; the caller resolves it against a year. */
  month: number | null;
  /** A four-digit year found in the question, e.g. "2025-yil avgust". */
  year: number | null;
  /** The keywords that fired, for the audit log and for debugging a bad answer. */
  matched: string[];
}

/**
 * Lower-cases and folds the apostrophe zoo.
 *
 * "O'zbekcha" is typed with `'`, `ʻ`, `'` or `` ` `` depending on the keyboard,
 * and a keyword list that matches only one of them silently fails for everyone
 * using the others.
 */
export function normalise(text: string): string {
  return (
    text
      .toLowerCase()
      // Apostrophes are DROPPED, not unified. Uzbek Latin writes them in six
      // shapes and most people typing a question write none at all — "eng
      // foydali yonalish" has to reach the same keyword as "yo'nalish", or the
      // assistant quietly answers a different question. The keyword tables and
      // the guard patterns are folded the same way, so they keep their
      // readable spelling in the source.
      .replace(/[‘’ʻʼ`´']/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Word-ish match: the term must not sit inside a longer word. */
function has(haystack: string, term: string): boolean {
  const index = haystack.indexOf(normalise(term));
  if (index === -1) return false;
  // Only the LEFT edge is strict: a term ending in a letter may still be
  // followed by an Uzbek or Russian case suffix ("reysga", "маршрутлар",
  // "рейсов"), and requiring a word boundary there would miss every inflected
  // form — which is most of them.
  const before = haystack[index - 1];
  return before === undefined || !/[\p{L}\p{N}]/u.test(before);
}

/**
 * Keyword table. Order matters only for `matched`; every intent whose terms
 * appear is returned, because real questions carry two ("qaysi truck eng ko'p
 * xarajat qildi" is VEHICLES + EXPENSE).
 */
const KEYWORDS: Record<AiIntent, string[]> = {
  REVENUE: [
    'daromad',
    'tushum',
    'даромад',
    'тушум',
    'выручк',
    'доход',
    'revenue',
    'income',
    'earned',
    'turnover',
  ],
  EXPENSE: [
    'xarajat',
    'harajat',
    'chiqim',
    'сарф',
    'харажат',
    'чиқим',
    'расход',
    'затрат',
    'потрат',
    'expense',
    'cost',
    'spend',
    'spent',
  ],
  PROFIT: ['foyda', 'фойда', 'прибыл', 'profit', 'earnings', 'net'],
  MARGIN: ['marja', 'rentabel', 'маржа', 'рентабел', 'margin', 'profitability'],
  TRIPS: ['reys', 'qatnov', 'рейс', 'қатнов', 'trip', 'load', 'haul', 'delivery'],
  ROUTES: ["yo'nalish", 'marshrut', 'yunalish', 'йўналиш', 'маршрут', 'route', 'lane', 'direction'],
  VEHICLES: [
    'mashina',
    'truck',
    'avtopark',
    'fura',
    'texnika',
    'машина',
    'техника',
    'грузовик',
    'фура',
    'автопарк',
    'vehicle',
    'fleet',
    'lorry',
  ],
  DRIVERS: ['haydovchi', 'shofyor', 'ҳайдовчи', 'водител', 'шофёр', 'driver'],
  FUEL: [
    "yoqilg'i",
    'yoqilgi',
    'benzin',
    'dizel',
    'solyarka',
    'litr',
    'ёқилғи',
    'бензин',
    'дизел',
    'топлив',
    'солярк',
    'литр',
    'fuel',
    'diesel',
    'petrol',
    'litre',
    'liter',
  ],
  DISTANCE: [
    'kilometr',
    'masofa',
    'km',
    'yurdi',
    'километр',
    'масофа',
    'пробег',
    'distance',
    'mileage',
  ],
  MONTHLY_COMPARISON: [
    'solishtir',
    'taqqosla',
    'солиштир',
    'таққосла',
    'сравн',
    'compare',
    'comparison',
    'trend',
    'тренд',
    'dinamik',
    'динамик',
    'oylar',
    'ойлар',
    'по месяцам',
  ],
  ANOMALY: [
    'anomal',
    'shubha',
    "g'alati",
    "o'g'irl",
    'аномал',
    'шубҳа',
    'ғалати',
    'подозрит',
    'странн',
    'краж',
    'anomaly',
    'unusual',
    'suspicious',
    'theft',
  ],
  RECOMMENDATION: [
    'tavsiya',
    'maslahat',
    'kerak',
    'nega',
    'тавсия',
    'маслаҳат',
    'керак',
    'нега',
    'совет',
    'рекоменд',
    'почему',
    'recommend',
    'advice',
    'should',
    'why',
    'improve',
  ],
};

/**
 * `km`, `net`, `why`, `kerak` and `nega` are short enough to appear inside
 * unrelated words ("kerakli", "network", "kilometr"), so they only count as a
 * whole word. Everything else matches on its left edge, which lets Uzbek and
 * Russian case suffixes through ("reysga", "рейсов", "маршрутлар").
 */
const WHOLE_WORD_ONLY = new Set(['km', 'net', 'why', 'should', 'kerak', 'nega', 'нега']);

function matches(text: string, term: string): boolean {
  if (!WHOLE_WORD_ONLY.has(term)) return has(text, term);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${term}([^\\p{L}\\p{N}]|$)`, 'u').test(text);
}

const MONTH_NAMES: Array<[number, string[]]> = [
  [0, ['yanvar', 'январ', 'january']],
  [1, ['fevral', 'феврал', 'february']],
  [2, ['mart', 'март', 'march']],
  [3, ['aprel', 'апрел', 'april']],
  [4, ['may', 'май']],
  [5, ['iyun', 'июн', 'june']],
  [6, ['iyul', 'июл', 'july']],
  [7, ['avgust', 'август', 'august']],
  [8, ['sentabr', 'сентябр', 'september']],
  [9, ['oktabr', 'октябр', 'october']],
  [10, ['noyabr', 'ноябр', 'november']],
  [11, ['dekabr', 'декабр', 'december']],
];

const PERIOD_TERMS: Array<[AiPeriodHint, string[]]> = [
  // Most specific first: "oxirgi 30 kun" also contains "kun".
  ['LAST_90_DAYS', ['90 kun', '90 дней', '90 кун', '90 days', '3 oy', '3 месяц']],
  ['LAST_30_DAYS', ['30 kun', '30 дней', '30 кун', '30 days', 'oxirgi oy', 'последн']],
  [
    'LAST_MONTH',
    ["o'tgan oy", 'utgan oy', 'ўтган ой', 'прошл', 'предыдущ', 'last month', 'previous month'],
  ],
  ['THIS_YEAR', ['bu yil', 'шу йил', 'этот год', 'в этом году', 'this year', 'yil boshidan']],
  ['THIS_MONTH', ['bu oy', 'шу ой', 'этот месяц', 'в этом месяце', 'this month', 'joriy oy']],
];

/**
 * Classifies a question. Never throws and never returns an empty intent list —
 * an unrecognised question falls back to the company overview, which is the
 * answer to "how are we doing" and a reasonable answer to almost anything else.
 */
export function detectIntent(question: string): DetectedIntent {
  const text = normalise(question);
  const intents: AiIntent[] = [];
  const matched: string[] = [];

  for (const intent of AI_INTENTS) {
    const hit = KEYWORDS[intent].find((term) => matches(text, term));
    if (hit) {
      intents.push(intent);
      matched.push(hit);
    }
  }

  let period: AiPeriodHint = 'THIS_MONTH';
  let month: number | null = null;
  // "2025-yil" / "в 2025 году" / "2025". Bounded so a plate or an amount
  // cannot be read as a year.
  const yearMatch = /(^|[^\d])(20[0-9]{2})([^\d]|$)/.exec(text);
  const year = yearMatch ? Number(yearMatch[2]) : null;

  const namedMonth = MONTH_NAMES.find(([, names]) => names.some((name) => has(text, name)));
  const explicit = PERIOD_TERMS.find(([, terms]) => terms.some((term) => has(text, term)));

  if (namedMonth) {
    period = 'NAMED_MONTH';
    month = namedMonth[0];
    matched.push(namedMonth[1][0]!);
  } else if (explicit) {
    period = explicit[0];
    matched.push(explicit[1].find((term) => has(text, term))!);
  }

  // An unrecognised question gets the company overview.
  if (intents.length === 0) {
    intents.push('REVENUE', 'EXPENSE', 'PROFIT', 'TRIPS');
  }

  // A bare year with no month means the whole year.
  if (year !== null && period === 'THIS_MONTH' && !namedMonth) {
    period = 'THIS_YEAR';
  }
  if (year !== null) matched.push(String(year));

  return { intents, period, month, year, matched };
}
