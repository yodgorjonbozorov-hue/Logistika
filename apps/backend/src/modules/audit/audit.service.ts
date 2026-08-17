import { Injectable, Logger } from '@nestjs/common';
import type { AuditLog, Prisma } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListAuditLogsDto } from './dto/list-audit.dto';

export interface AuditEntry {
  companyId?: string | null;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

/** The minimum shape needed to write an audit row inside a transaction. */
export interface AuditWriter {
  auditLog: {
    create(args: { data: Prisma.AuditLogUncheckedCreateInput }): Promise<unknown>;
  };
}

/**
 * Fields that must never reach the audit table. A log that records what someone
 * changed is useful; one that records the password they changed it to is a
 * second copy of the credential store.
 */
const SENSITIVE_FIELDS =
  /^(password|passwordHash|token|tokenHash|codeHash|refreshToken|accessToken|secret)/i;

/**
 * Prepares a database row for the audit log: BigInt and Decimal become strings
 * (JSON has neither, and money must not go through a float), and sensitive
 * fields are replaced by a boolean marker that still records that they changed.
 */
export function toAuditJson(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object') return value as Prisma.InputJsonValue;

  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_FIELDS.test(key)) {
      result[`${key.replace(/Hash$/, '')}Changed`] = raw !== undefined && raw !== null;
      continue;
    }
    if (typeof raw === 'bigint') {
      result[key] = raw.toString();
    } else if (raw instanceof Date) {
      result[key] = raw.toISOString();
    } else if (raw && typeof raw === 'object' && 'toFixed' in raw) {
      // Prisma.Decimal — stringified so no precision is lost on the way in.
      result[key] = String(raw);
    } else if (raw && typeof raw === 'object') {
      result[key] = toAuditJson(raw);
    } else {
      result[key] = raw;
    }
  }
  return result as Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fire-and-forget: an audit failure must never break the user flow, but is
   * always logged. Suitable for secondary events (login, listings).
   *
   * Money and other sensitive mutations should use logInTx instead, so the
   * record and the change stand or fall together.
   */
  log(entry: AuditEntry): void {
    void this.prisma.auditLog.create({ data: this.toRow(entry) }).catch((error: unknown) => {
      this.logger.warn(
        `Audit write failed for ${entry.action} ${entry.entityType}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  /**
   * Writes the audit row inside the caller's transaction.
   *
   * Fire-and-forget leaves the two out of step: a rolled-back change can keep
   * its audit entry, and a successful one can lose it. For anything touching
   * money or permissions, "the log says it happened" has to mean it happened.
   */
  async logInTx(tx: AuditWriter, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({ data: this.toRow(entry) });
  }

  /** Tenant-scoped read of the trail (OWNER only — see AuditController). */
  async list(
    actor: CurrentUserPayload,
    filter: ListAuditLogsDto,
  ): Promise<{ data: AuditLog[]; total: number }> {
    const where: Prisma.AuditLogWhereInput = {
      // SUPERADMIN has no tenant of its own and reads the platform-wide trail.
      companyId: actor.companyId ?? undefined,
      entityType: filter.entityType,
      entityId: filter.entityId,
      userId: filter.userId,
      action: filter.action,
      createdAt: filter.from || filter.to ? { gte: filter.from, lte: filter.to } : undefined,
    };
    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, total };
  }

  private toRow(entry: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
    return {
      companyId: entry.companyId ?? null,
      userId: entry.userId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before,
      after: entry.after,
    };
  }
}
