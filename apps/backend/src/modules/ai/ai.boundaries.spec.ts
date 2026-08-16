import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CHAT_FUNCTIONS, CHAT_TOOLS } from './chat.functions';
import { OCR_TOOL } from './ocr.prompt';
import { ANOMALY_TOOL } from './anomaly.prompt';
import { CHAT_ANSWER_TOOL } from './chat.prompt';
import { DIGEST_TOOL } from './digest.prompt';
import { VOICE_TOOL } from './voice.prompt';

/**
 * The rules of TZ §8.12, asserted against the module itself rather than against
 * one flow at a time. Each of these has a matching behavioural test in the
 * service specs; these catch the case where a *new* AI feature quietly breaks
 * the rule the others keep.
 */
const AI_DIR = __dirname;

function sourceFiles(): Array<{ name: string; text: string }> {
  return readdirSync(AI_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
    .map((name) => ({ name, text: readFileSync(join(AI_DIR, name), 'utf8') }));
}

describe('rule 1 — AI never writes to the database', () => {
  /** Tables the AI module owns: its own log, its findings, its own settings. */
  const OWN_TABLES = ['aiRequest', 'aiInsight', 'aiSettings'];
  /** Prisma writes only: `db.x.create(`, or a `forCompany(...)` chain. */
  const WRITES =
    /(?:\bdb|forCompany\([^)]*\))\s*\.\s*(\w+)\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g;

  it('writes only to ai_requests, ai_insights and ai_settings', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      // Chains span lines; flatten first so the pattern sees them whole.
      const flat = file.text.replace(/\s+/g, ' ');
      for (const [, model, operation] of flat.matchAll(WRITES)) {
        if (!OWN_TABLES.includes(model as string)) {
          offenders.push(`${file.name}: ${model}.${operation}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('rule 2 — AI never writes SQL', () => {
  it('uses no raw query anywhere in the module', () => {
    const offenders = sourceFiles()
      .filter((file) => /\$queryRaw|\$executeRaw|\$queryRawUnsafe/.test(file.text))
      .map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it('offers the model a fixed list of prepared queries, not a query language', () => {
    expect(CHAT_TOOLS.map((tool) => tool.name)).toEqual([...CHAT_FUNCTIONS]);
    for (const tool of CHAT_TOOLS) {
      const schema = tool.schema as { properties?: Record<string, unknown> };
      const properties = Object.keys(schema.properties ?? {});
      // Parameters are dates, names and one enum — nothing that carries a query.
      expect(
        properties.every((name) =>
          /^(from|to|compare_from|compare_to|metric|vehicle|driver|route|status)$/.test(name),
        ),
      ).toBe(true);
    }
  });
});

describe('rule 3 — every query is scoped to one company', () => {
  it('never reaches for the unscoped client on a tenant table', () => {
    // `prisma.company` and `prisma.storedFile` are deliberate: Company IS the
    // tenant, and file retention is a platform job keyed by expires_at.
    const allowed = /this\.prisma\.(forCompany|company)\b/;
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      for (const match of file.text.matchAll(/this\.prisma\.\w+/g)) {
        if (!allowed.test(match[0])) offenders.push(`${file.name}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('takes the company from the caller, never from a model answer', () => {
    const offenders = sourceFiles()
      .filter((file) => /companyId:\s*(source|raw|fields|data)\b/.test(file.text))
      .map((file) => file.name);
    expect(offenders).toEqual([]);
  });
});

describe('rule 4 — personal data is not sent to the model', () => {
  /** Identifiers TZ §8.12 rule 4 keeps out of a prompt; an id may go instead. */
  const PERSONAL = /passport|passwordHash|licenseNumber|phoneNumber|bankAccount|\binn\b/i;

  it('builds no prompt out of a personal identifier', () => {
    const offenders = sourceFiles()
      .filter((file) => file.name.endsWith('.prompt.ts'))
      .filter((file) => PERSONAL.test(file.text))
      .map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it('selects no personal column in a service that feeds one', () => {
    const offenders = sourceFiles()
      .filter((file) => file.name.endsWith('.service.ts'))
      .filter((file) => PERSONAL.test(file.text))
      .map((file) => file.name);
    expect(offenders).toEqual([]);
  });
});

describe('rule 7 — the model produces words, the code produces figures', () => {
  const TOOLS = [OCR_TOOL, VOICE_TOOL, ANOMALY_TOOL, CHAT_ANSWER_TOOL, DIGEST_TOOL];

  it('asks the model to read or explain, never to compute', () => {
    for (const tool of TOOLS) {
      const schema = JSON.stringify(tool.schema).toLowerCase();
      for (const forbidden of ['profit', 'margin', 'total_cost', 'deviation', 'roi']) {
        expect(`${tool.name}:${schema.includes(forbidden)}`).toBe(`${tool.name}:false`);
      }
    }
  });

  it('lets only the reading tools return numbers at all', () => {
    // OCR and voice report what is printed or spoken; the rest write prose.
    const numeric = TOOLS.filter((tool) =>
      JSON.stringify(tool.schema).includes("'number'".replace(/'/g, '"')),
    );
    expect(numeric.map((tool) => tool.name).sort()).toEqual([
      'report_document',
      'report_voice_entry',
    ]);
  });
});

describe('the proposal → confirmation flow (TZ §8.0)', () => {
  it('never marks a fresh AI result as confirmed', () => {
    const service = readFileSync(join(AI_DIR, 'ai.service.ts'), 'utf8');
    const createBlock = service.slice(service.indexOf('db.aiRequest.create'));
    expect(createBlock.slice(0, createBlock.indexOf('});'))).not.toContain('isConfirmed');
  });

  it('sets isConfirmed only where a user id is recorded with it', () => {
    const service = readFileSync(join(AI_DIR, 'ai.service.ts'), 'utf8');
    const confirmBlock = service.slice(service.indexOf('isConfirmed: true'));
    expect(confirmBlock.slice(0, 200)).toContain('confirmedBy');
  });
});
