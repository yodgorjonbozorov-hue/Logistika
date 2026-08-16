import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { PeriodDto } from '../finance/dto/finance.dto';
import type { AiToolSpec } from './ai.client';
import {
  asObject,
  optionalDate,
  optionalEnum,
  optionalString,
  requiredEnum,
} from './ai.validation';

/**
 * The whitelist AI-3 may call (TZ §8.4).
 *
 * The model picks a name and its arguments; the system runs the query. That is
 * the entire safety story: there is no path from a question to a SQL string, and
 * an argument the model invents can at worst name an entity this company does
 * not have — every resolver runs on the tenant-scoped services.
 */
export const CHAT_FUNCTIONS = [
  'get_vehicle_profit',
  'get_driver_stats',
  'get_fuel_anomalies',
  'get_route_profitability',
  'get_receivables',
  'compare_periods',
] as const;
export type ChatFunction = (typeof CHAT_FUNCTIONS)[number];

export const COMPARABLE_METRICS = ['revenue', 'cost', 'profit', 'tripCount', 'distanceKm'] as const;
export type ComparableMetric = (typeof COMPARABLE_METRICS)[number];

const PERIOD_PROPERTIES = {
  from: { type: 'string', description: 'Start of the window, ISO 8601. Omit for this month.' },
  to: { type: 'string', description: 'End of the window, ISO 8601. Omit for now.' },
};

/** Every call is period-scoped, so the numbers always state what they cover. */
export interface ChatCall {
  name: ChatFunction;
  period: PeriodDto;
  /** Second window, only for compare_periods. */
  comparePeriod?: PeriodDto;
  metric?: ComparableMetric;
  /** Plate number, driver name or route text the boss used in the question. */
  subject?: string;
  status?: string;
}

export const CHAT_TOOLS: AiToolSpec[] = [
  {
    name: 'get_vehicle_profit',
    description:
      'Profit, revenue, cost, cost per km and ROI for every vehicle in a period. ' +
      'Use for questions about which truck earns or loses money.',
    schema: {
      type: 'object',
      properties: {
        ...PERIOD_PROPERTIES,
        vehicle: { type: 'string', description: 'Plate number, if the question named one.' },
      },
    },
  },
  {
    name: 'get_driver_stats',
    description: 'Per-driver trip count, distance, revenue, profit and fuel deviation in a period.',
    schema: {
      type: 'object',
      properties: {
        ...PERIOD_PROPERTIES,
        driver: { type: 'string', description: 'Driver name, if the question named one.' },
      },
    },
  },
  {
    name: 'get_fuel_anomalies',
    description:
      'The fuel control table: norm against actual litres per vehicle, the deviation and ' +
      'what the overrun cost. Use for questions about fuel, overspending or theft.',
    schema: { type: 'object', properties: PERIOD_PROPERTIES },
  },
  {
    name: 'get_route_profitability',
    description: 'Revenue, cost and profit per route in a period.',
    schema: {
      type: 'object',
      properties: {
        ...PERIOD_PROPERTIES,
        route: { type: 'string', description: 'Route text, if the question named one.' },
      },
    },
  },
  {
    name: 'get_receivables',
    description: 'What clients still owe: pending, overdue and paid amounts per client.',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional filter: overdue | pending | paid.' },
      },
    },
  },
  {
    name: 'compare_periods',
    description:
      'One company-wide metric in two periods, for questions like "did profit grow ' +
      'compared with last month".',
    schema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: [...COMPARABLE_METRICS] },
        from: { type: 'string', description: 'Start of the first window, ISO 8601.' },
        to: { type: 'string', description: 'End of the first window, ISO 8601.' },
        compare_from: { type: 'string', description: 'Start of the second window, ISO 8601.' },
        compare_to: { type: 'string', description: 'End of the second window, ISO 8601.' },
      },
      required: ['metric'],
    },
  },
];

/** An unnamed end of the window falls back to PeriodDto's own default. */
function periodFrom(source: Record<string, unknown>, fromKey: string, toKey: string): PeriodDto {
  const period = new PeriodDto();
  period.from = optionalDate(source, fromKey)?.toISOString();
  period.to = optionalDate(source, toKey)?.toISOString();
  return period;
}

/**
 * Validates the model's choice. A name outside the list is rejected outright —
 * that check is what makes this a whitelist rather than a suggestion.
 */
export function parseChatCall(raw: unknown, toolName: string): ChatCall {
  const source = asObject(raw);
  const name = requiredEnum({ name: toolName }, 'name', CHAT_FUNCTIONS);
  const metric = optionalEnum(source, 'metric', COMPARABLE_METRICS) ?? undefined;
  if (name === 'compare_periods' && !metric) {
    throw new AppException('AI_INVALID_RESPONSE', HttpStatus.BAD_GATEWAY, undefined, {
      field: 'metric',
    });
  }

  return {
    name,
    period: periodFrom(source, 'from', 'to'),
    comparePeriod:
      name === 'compare_periods' ? periodFrom(source, 'compare_from', 'compare_to') : undefined,
    metric,
    subject:
      optionalString(source, 'vehicle', 100) ??
      optionalString(source, 'driver', 100) ??
      optionalString(source, 'route', 200) ??
      undefined,
    status: optionalString(source, 'status', 40) ?? undefined,
  };
}
