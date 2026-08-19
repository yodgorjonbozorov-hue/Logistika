/**
 * What the assistant refuses to take as a question.
 *
 * This runs BEFORE any data is fetched and before the provider is called, and
 * it is defence in depth rather than the tenant boundary itself: the boundary
 * is that `companyId` comes from the JWT and the analytics layer binds it into
 * every query, so a question asking for another company's numbers gets its own
 * company's numbers no matter what. That is a confusing answer, though, and an
 * operator who typed it deserves to be told plainly that it cannot be done —
 * hence an explicit refusal.
 *
 * The SQL and instruction-override rules are the same idea. Nothing downstream
 * would execute either (the model never sees a database and its output is
 * checked against pre-computed figures), but a refusal is a cheaper, clearer
 * and more auditable answer than letting the request run.
 */
import { normalise } from './intent';

export const PROMPT_REFUSALS = [
  'TOO_SHORT',
  'TOO_LONG',
  'CROSS_TENANT',
  'RAW_SQL',
  'INSTRUCTION_OVERRIDE',
  'WRITE_ATTEMPT',
] as const;
export type PromptRefusal = (typeof PROMPT_REFUSALS)[number];

export interface PromptCheck {
  ok: boolean;
  refusal?: PromptRefusal;
  /** The pattern that fired — logged, never shown to the user. */
  matched?: string;
}

export const MIN_PROMPT_CHARS = 3;

/** Asking about another company, by any phrasing that names one. */
const CROSS_TENANT = [
  'company b',
  'kompaniya b',
  'boshqa kompaniya',
  'boshqa firma',
  "o'zga kompaniya",
  'бошқа компания',
  'другой компан',
  'другая компан',
  'чужой компан',
  'other company',
  'another company',
  'all companies',
  'every company',
  'barcha kompaniya',
  'все компании',
  'companyid',
  'company_id',
  'tenant',
];

/** Asking for database access rather than an answer. */
const RAW_SQL = [
  'select * from',
  'select 1',
  'insert into',
  'update set',
  'delete from',
  'drop table',
  'drop database',
  'truncate',
  'union select',
  'pg_',
  'information_schema',
  'sql so',
  'sql query',
  'sql zapros',
  'raw sql',
  'запрос sql',
  'sql-запрос',
  'run sql',
  'execute sql',
];

/** Trying to rewrite the assistant's instructions. */
const INSTRUCTION_OVERRIDE = [
  'ignore previous',
  'ignore all previous',
  'ignore your instructions',
  'disregard the above',
  'system prompt',
  'you are now',
  'act as if',
  'developer mode',
  'jailbreak',
  'avvalgi ko',
  "ko'rsatmalarni unut",
  'qoidalarni unut',
  'кўрсатмаларни унут',
  'забудь предыдущ',
  'игнорируй',
  'системный промпт',
  'ты теперь',
];

/**
 * Asking the assistant to change data. It is read-only by construction, so the
 * refusal is informative rather than protective.
 *
 * Every pattern here is an imperative PHRASE, never a bare verb stem. `изменить`
 * alone would refuse "покажи изменение расходов" ("show the change in
 * expenses"), which is an ordinary and useful question.
 */
const WRITE_ATTEMPT = [
  'reys yarat',
  'yangi reys qo',
  "reysni o'chir",
  'xarajat qo',
  "o'chirib tashla",
  'создай рейс',
  'создать рейс',
  'добавь расход',
  'удали рейс',
  'удалить рейс',
  'create a trip',
  'create trip',
  'add an expense',
  'delete the trip',
  'update the trip',
  'change the vehicle',
];

const RULES: Array<[PromptRefusal, string[]]> = [
  ['CROSS_TENANT', CROSS_TENANT],
  ['RAW_SQL', RAW_SQL],
  ['INSTRUCTION_OVERRIDE', INSTRUCTION_OVERRIDE],
  ['WRITE_ATTEMPT', WRITE_ATTEMPT],
];

/**
 * @param maxChars from configuration, so a deployment can tighten it without a
 *        code change. A long prompt is both a cost and an injection surface.
 */
export function checkPrompt(question: string, maxChars: number): PromptCheck {
  const trimmed = question.trim();
  if (trimmed.length < MIN_PROMPT_CHARS) return { ok: false, refusal: 'TOO_SHORT' };
  if (trimmed.length > maxChars) return { ok: false, refusal: 'TOO_LONG' };

  const text = normalise(trimmed);
  for (const [refusal, patterns] of RULES) {
    // The pattern is folded too: the tables spell "o'chirib tashla" the way a
    // reader expects, while normalise() has already stripped the apostrophe
    // out of the question.
    const hit = patterns.find((pattern) => text.includes(normalise(pattern)));
    if (hit) return { ok: false, refusal, matched: hit };
  }
  return { ok: true };
}
