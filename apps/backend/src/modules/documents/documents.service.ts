import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Document, DocumentOwnerType, Prisma } from '@prisma/client';
import { AlertType, type CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsService, type AlertInput } from '../alerts/alerts.service';
import { AuditService } from '../audit/audit.service';
import { CreateDocumentDto, ListDocumentsDto, UpdateDocumentDto } from './dto/document.dto';

/** TZ §7 / W-10: remind 15, 7 and 1 day before expiry; 0 means already expired. */
export const REMINDER_DAYS = [15, 7, 1] as const;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ExpiringDocument {
  id: string;
  ownerType: DocumentOwnerType;
  ownerId: string;
  ownerLabel: string | null;
  docType: string;
  docNumber: string | null;
  expiryDate: Date;
  daysLeft: number;
}

/** Whole days from `now` to `expiry`; negative once the document has expired. */
export function daysUntil(expiry: Date, now: Date): number {
  return Math.ceil((expiry.getTime() - now.getTime()) / MS_PER_DAY);
}

/**
 * Which reminder step a document falls into: the closest step still ahead of it,
 * 0 for an expired document, null when it is too far out to bother anyone.
 */
export function reminderBucket(daysLeft: number): number | null {
  if (daysLeft < 0) return 0;
  for (const step of [...REMINDER_DAYS].sort((a, b) => a - b)) {
    if (daysLeft <= step) return step;
  }
  return null;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: CurrentUserPayload,
    filter: ListDocumentsDto,
  ): Promise<{ data: Document[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const where: Prisma.DocumentWhereInput = {
      ownerType: filter.ownerType,
      ownerId: filter.ownerId,
      docType: filter.docType,
    };
    const [data, total] = await Promise.all([
      db.document.findMany({
        where,
        orderBy: [{ expiryDate: 'asc' }, { createdAt: 'desc' }],
        skip: filter.skip,
        take: filter.limit,
      }),
      db.document.count({ where }),
    ]);
    return { data, total };
  }

  async create(actor: CurrentUserPayload, dto: CreateDocumentDto): Promise<Document> {
    await this.requireOwner(actor, dto.ownerType, dto.ownerId);
    try {
      const created = await this.prisma.forCompany(actor.companyId).document.create({
        data: toDocumentData(dto) as Prisma.DocumentUncheckedCreateInput,
      });
      this.audit.record(actor, 'CREATE', 'Document', created);
      return created;
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async update(actor: CurrentUserPayload, id: string, dto: UpdateDocumentDto): Promise<Document> {
    const db = this.prisma.forCompany(actor.companyId);
    const existing = await db.document.findUnique({ where: { id } });
    if (!existing) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    if (dto.ownerType && dto.ownerId) await this.requireOwner(actor, dto.ownerType, dto.ownerId);
    try {
      // A new expiry date starts a fresh reminder cycle.
      const data = toDocumentData(dto);
      const updated = await db.document.update({
        where: { id },
        data: dto.expiryDate ? { ...data, reminderSent: false } : data,
      });
      this.audit.record(actor, 'UPDATE', 'Document', updated, existing);
      return updated;
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async remove(actor: CurrentUserPayload, id: string): Promise<{ deleted: boolean }> {
    const db = this.prisma.forCompany(actor.companyId);
    const existing = await db.document.findUnique({ where: { id } });
    if (!existing) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    await db.document.delete({ where: { id } });
    this.audit.record(actor, 'DELETE', 'Document', existing);
    return { deleted: true };
  }

  /**
   * Documents whose expiry is within `withinDays` (expired ones included).
   * Vehicle insurance / tech inspection and driver licences live on their own
   * cards, so they are folded in here as virtual documents.
   */
  async expiring(
    actor: CurrentUserPayload,
    withinDays: number = REMINDER_DAYS[0],
    now = new Date(),
  ): Promise<ExpiringDocument[]> {
    const db = this.prisma.forCompany(actor.companyId);
    const until = new Date(now.getTime() + withinDays * MS_PER_DAY);

    const [documents, vehicles, drivers] = await Promise.all([
      db.document.findMany({
        where: { expiryDate: { not: null, lte: until } },
        orderBy: { expiryDate: 'asc' },
      }),
      db.vehicle.findMany({
        where: {
          isActive: true,
          OR: [
            { insuranceExpiry: { not: null, lte: until } },
            { techInspectionExpiry: { not: null, lte: until } },
          ],
        },
        select: {
          id: true,
          plateNumber: true,
          insuranceExpiry: true,
          techInspectionExpiry: true,
        },
      }),
      db.driver.findMany({
        where: { isActive: true, licenseExpiry: { not: null, lte: until } },
        select: { id: true, fullName: true, licenseNumber: true, licenseExpiry: true },
      }),
    ]);

    const labels = await this.ownerLabels(actor, documents);
    const rows: ExpiringDocument[] = documents
      .filter((document) => document.expiryDate)
      .map((document) => ({
        id: document.id,
        ownerType: document.ownerType,
        ownerId: document.ownerId,
        ownerLabel: labels.get(`${document.ownerType}:${document.ownerId}`) ?? null,
        docType: document.docType,
        docNumber: document.docNumber,
        expiryDate: document.expiryDate as Date,
        daysLeft: daysUntil(document.expiryDate as Date, now),
      }));

    for (const vehicle of vehicles) {
      if (vehicle.insuranceExpiry) {
        rows.push(
          virtualDocument(
            vehicle.id,
            'VEHICLE',
            vehicle.plateNumber,
            'INSURANCE',
            vehicle.insuranceExpiry,
            now,
          ),
        );
      }
      if (vehicle.techInspectionExpiry) {
        rows.push(
          virtualDocument(
            vehicle.id,
            'VEHICLE',
            vehicle.plateNumber,
            'TECH_INSPECTION',
            vehicle.techInspectionExpiry,
            now,
          ),
        );
      }
    }
    for (const driver of drivers) {
      rows.push(
        virtualDocument(
          driver.id,
          'DRIVER',
          driver.fullName,
          'DRIVER_LICENSE',
          driver.licenseExpiry as Date,
          now,
          driver.licenseNumber,
        ),
      );
    }

    return rows.sort((a, b) => a.daysLeft - b.daysLeft);
  }

  /** Raises DOCUMENT_EXPIRING alerts at the 15/7/1-day steps (and once expired). */
  async checkExpiries(companyId: string, now = new Date()): Promise<number> {
    const actor = { userId: null, companyId, role: 'OWNER' } as unknown as CurrentUserPayload;
    const rows = await this.expiring(actor, REMINDER_DAYS[0], now);

    const alerts: AlertInput[] = [];
    for (const row of rows) {
      const bucket = reminderBucket(row.daysLeft);
      if (bucket === null) continue;
      alerts.push({
        type: AlertType.DOCUMENT_EXPIRING,
        titleKey: bucket === 0 ? 'alerts.documentExpired.title' : 'alerts.documentExpiring.title',
        messageKey:
          bucket === 0 ? 'alerts.documentExpired.message' : 'alerts.documentExpiring.message',
        params: {
          docType: row.docType,
          owner: row.ownerLabel ?? row.ownerId,
          daysLeft: bucket,
          date: row.expiryDate.toISOString().slice(0, 10),
        },
        relatedType: 'Document',
        relatedId: row.id,
        // 15 → 7 → 1 → expired each deserve their own alert.
        dedupeParam: 'daysLeft',
      });
    }
    return this.alerts.raiseMany(companyId, alerts);
  }

  /** Daily document watch (TZ W-10). */
  @Cron('0 6 * * *')
  async checkAllCompanies(): Promise<void> {
    const companies = await this.prisma.company.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    for (const company of companies) {
      try {
        const raised = await this.checkExpiries(company.id);
        if (raised > 0) this.logger.log(`Document alerts raised: ${raised} (${company.id})`);
      } catch (error) {
        this.logger.error(
          `Document check failed for ${company.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /** The owner must exist inside the tenant — cross-company ids look missing. */
  private async requireOwner(
    actor: CurrentUserPayload,
    ownerType: DocumentOwnerType,
    ownerId: string,
  ): Promise<void> {
    const db = this.prisma.forCompany(actor.companyId);
    const found =
      ownerType === 'VEHICLE'
        ? await db.vehicle.findUnique({ where: { id: ownerId }, select: { id: true } })
        : ownerType === 'DRIVER'
          ? await db.driver.findUnique({ where: { id: ownerId }, select: { id: true } })
          : ownerType === 'TRIP'
            ? await db.trip.findUnique({ where: { id: ownerId }, select: { id: true } })
            : // COMPANY documents are owned by the tenant itself.
              actor.companyId === ownerId
              ? { id: ownerId }
              : null;
    if (!found) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
  }

  /** Human labels (plate number / driver name) for the owners of given documents. */
  private async ownerLabels(
    actor: CurrentUserPayload,
    documents: Array<{ ownerType: DocumentOwnerType; ownerId: string }>,
  ): Promise<Map<string, string>> {
    const db = this.prisma.forCompany(actor.companyId);
    const vehicleIds = documents.filter((d) => d.ownerType === 'VEHICLE').map((d) => d.ownerId);
    const driverIds = documents.filter((d) => d.ownerType === 'DRIVER').map((d) => d.ownerId);
    const [vehicles, drivers] = await Promise.all([
      vehicleIds.length
        ? db.vehicle.findMany({
            where: { id: { in: vehicleIds } },
            select: { id: true, plateNumber: true },
          })
        : [],
      driverIds.length
        ? db.driver.findMany({
            where: { id: { in: driverIds } },
            select: { id: true, fullName: true },
          })
        : [],
    ]);

    const labels = new Map<string, string>();
    for (const vehicle of vehicles) labels.set(`VEHICLE:${vehicle.id}`, vehicle.plateNumber);
    for (const driver of drivers) labels.set(`DRIVER:${driver.id}`, driver.fullName);
    return labels;
  }
}

function toDocumentData(dto: CreateDocumentDto | UpdateDocumentDto) {
  const { issueDate, expiryDate, ...rest } = dto;
  return {
    ...rest,
    issueDate: issueDate === undefined ? undefined : new Date(issueDate),
    expiryDate: expiryDate === undefined ? undefined : new Date(expiryDate),
  };
}

/** Expiry dates stored on the vehicle/driver card, presented like documents. */
function virtualDocument(
  ownerId: string,
  ownerType: DocumentOwnerType,
  ownerLabel: string,
  docType: string,
  expiryDate: Date,
  now: Date,
  docNumber: string | null = null,
): ExpiringDocument {
  return {
    // Stable synthetic id so the alert dedupe keeps working across runs.
    id: `${ownerType.toLowerCase()}:${ownerId}:${docType}`,
    ownerType,
    ownerId,
    ownerLabel,
    docType,
    docNumber,
    expiryDate,
    daysLeft: daysUntil(expiryDate, now),
  };
}
