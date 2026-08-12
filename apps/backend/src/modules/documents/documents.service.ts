import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Document, Prisma } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { CreateDocumentDto, ListDocumentsDto, UpdateDocumentDto } from './dto/document.dto';

/** TZ §4.1 W-10: reminders fire at 15/7/1 days before expiry (and on overdue). */
export const REMINDER_DAYS = [15, 7, 1] as const;

export interface ExpiringItem {
  /** documents table row, or a built-in expiry field of a vehicle/driver. */
  source: 'DOCUMENT' | 'VEHICLE_INSURANCE' | 'VEHICLE_TECH_INSPECTION' | 'DRIVER_LICENSE';
  ownerType: string;
  ownerId: string;
  /** Plate number / driver name / document number — whatever identifies it. */
  label: string;
  docType: string;
  expiryDate: Date;
  daysLeft: number;
}

function daysLeft(expiry: Date, now: Date): number {
  return Math.ceil((expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

function toData(dto: CreateDocumentDto | UpdateDocumentDto) {
  const { issueDate, expiryDate, ...rest } = dto;
  return {
    ...rest,
    issueDate: issueDate === undefined ? undefined : new Date(issueDate),
    expiryDate: expiryDate === undefined ? undefined : new Date(expiryDate),
  };
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  async list(
    actor: CurrentUserPayload,
    filter: ListDocumentsDto,
  ): Promise<{ data: Document[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const where: Prisma.DocumentWhereInput = {
      ownerType: filter.ownerType,
      ownerId: filter.ownerId,
    };
    const [data, total] = await Promise.all([
      db.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.limit,
      }),
      db.document.count({ where }),
    ]);
    return { data, total };
  }

  async getById(actor: CurrentUserPayload, id: string): Promise<Document> {
    const doc = await this.prisma
      .forCompany(actor.companyId)
      .document.findUnique({ where: { id } });
    if (!doc) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return doc;
  }

  async create(actor: CurrentUserPayload, dto: CreateDocumentDto): Promise<Document> {
    try {
      return await this.prisma.forCompany(actor.companyId).document.create({
        data: toData(dto) as Prisma.DocumentUncheckedCreateInput,
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async update(actor: CurrentUserPayload, id: string, dto: UpdateDocumentDto): Promise<Document> {
    try {
      return await this.prisma
        .forCompany(actor.companyId)
        .document.update({ where: { id }, data: toData(dto) });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async remove(actor: CurrentUserPayload, id: string): Promise<{ deleted: boolean }> {
    const existing = await this.prisma
      .forCompany(actor.companyId)
      .document.findUnique({ where: { id } });
    if (!existing) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.prisma.forCompany(actor.companyId).document.delete({ where: { id } });
    return { deleted: true };
  }

  /** Everything with an expiry inside the window — incl. overdue items. */
  async expiring(actor: CurrentUserPayload, days: number): Promise<ExpiringItem[]> {
    if (!actor.companyId) throw new AppException('TENANT_MISSING', HttpStatus.FORBIDDEN);
    return this.expiringForCompany(actor.companyId, days);
  }

  private async expiringForCompany(companyId: string, days: number): Promise<ExpiringItem[]> {
    const now = new Date();
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const db = this.prisma.forCompany(companyId);

    const [documents, vehicles, drivers] = await Promise.all([
      db.document.findMany({ where: { expiryDate: { not: null, lte: until } } }),
      db.vehicle.findMany({
        where: {
          isActive: true,
          OR: [
            { insuranceExpiry: { not: null, lte: until } },
            { techInspectionExpiry: { not: null, lte: until } },
          ],
        },
      }),
      db.driver.findMany({ where: { isActive: true, licenseExpiry: { not: null, lte: until } } }),
    ]);

    const items: ExpiringItem[] = [];
    for (const doc of documents) {
      if (!doc.expiryDate) continue;
      items.push({
        source: 'DOCUMENT',
        ownerType: doc.ownerType,
        ownerId: doc.ownerId,
        label: doc.docNumber ?? doc.docType,
        docType: doc.docType,
        expiryDate: doc.expiryDate,
        daysLeft: daysLeft(doc.expiryDate, now),
      });
    }
    for (const vehicle of vehicles) {
      if (vehicle.insuranceExpiry && vehicle.insuranceExpiry <= until) {
        items.push({
          source: 'VEHICLE_INSURANCE',
          ownerType: 'VEHICLE',
          ownerId: vehicle.id,
          label: vehicle.plateNumber,
          docType: 'insurance',
          expiryDate: vehicle.insuranceExpiry,
          daysLeft: daysLeft(vehicle.insuranceExpiry, now),
        });
      }
      if (vehicle.techInspectionExpiry && vehicle.techInspectionExpiry <= until) {
        items.push({
          source: 'VEHICLE_TECH_INSPECTION',
          ownerType: 'VEHICLE',
          ownerId: vehicle.id,
          label: vehicle.plateNumber,
          docType: 'tech_inspection',
          expiryDate: vehicle.techInspectionExpiry,
          daysLeft: daysLeft(vehicle.techInspectionExpiry, now),
        });
      }
    }
    for (const driver of drivers) {
      if (!driver.licenseExpiry) continue;
      items.push({
        source: 'DRIVER_LICENSE',
        ownerType: 'DRIVER',
        ownerId: driver.id,
        label: driver.fullName,
        docType: 'driver_license',
        expiryDate: driver.licenseExpiry,
        daysLeft: daysLeft(driver.licenseExpiry, now),
      });
    }
    return items.sort((a, b) => a.daysLeft - b.daysLeft);
  }

  /**
   * Daily reminder job (TZ §4.1 W-10, ROADMAP 7): expiry alerts at the 15/7/1
   * day marks and for anything already overdue. AlertsService swallows
   * duplicates while a previous alert stays unread.
   */
  @Cron('0 6 * * *')
  async sendExpiryReminders(): Promise<void> {
    try {
      const companies = await this.prisma.company.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      for (const company of companies) {
        const items = await this.expiringForCompany(company.id, Math.max(...REMINDER_DAYS));
        for (const item of items) {
          const atMark = (REMINDER_DAYS as readonly number[]).includes(item.daysLeft);
          const overdue = item.daysLeft <= 0;
          if (!atMark && !overdue) continue;
          await this.alerts.raise(company.id, {
            type: 'DOC_EXPIRY',
            params: {
              label: item.label,
              docType: item.docType,
              daysLeft: Math.max(item.daysLeft, 0),
              expiryDate: item.expiryDate.toISOString(),
            },
            relatedType: item.ownerType,
            relatedId: item.ownerId,
          });
        }
      }
    } catch (error) {
      this.logger.error(
        `Document expiry reminders failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
