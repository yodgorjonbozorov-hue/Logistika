import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/settings.dto';

/** TZ §8.10 defaults, used until a company saves its own thresholds. */
export const DEFAULT_SETTINGS = {
  fuelDeviationThresholdBp: 700, // 7%
  idleAlertHours: 2,
  routeDeviationKm: 20,
  digestTime: '20:00',
} as const;

export interface CompanyThresholds {
  fuelDeviationThresholdBp: number;
  idleAlertHours: number;
  routeDeviationKm: number;
  digestTime: string;
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Alert thresholds of a company (W-11 settings). The row is created lazily —
   * until then every check runs on the TZ defaults.
   */
  async thresholds(companyId: string): Promise<CompanyThresholds> {
    const row = await this.prisma.forCompany(companyId).aiSettings.findFirst();
    if (!row) return { ...DEFAULT_SETTINGS };
    return {
      fuelDeviationThresholdBp: row.fuelDeviationThresholdBp,
      idleAlertHours: row.idleAlertHours,
      routeDeviationKm: row.routeDeviationKm,
      digestTime: row.digestTime,
    };
  }

  async update(companyId: string, dto: UpdateSettingsDto): Promise<CompanyThresholds> {
    const db = this.prisma.forCompany(companyId);
    const existing = await db.aiSettings.findFirst({ select: { id: true } });
    const row = existing
      ? await db.aiSettings.update({ where: { id: existing.id }, data: { ...dto } })
      : // companyId is stamped by the tenant extension, never taken from input.
        await db.aiSettings.create({ data: { ...dto } as Prisma.AiSettingsUncheckedCreateInput });
    return {
      fuelDeviationThresholdBp: row.fuelDeviationThresholdBp,
      idleAlertHours: row.idleAlertHours,
      routeDeviationKm: row.routeDeviationKm,
      digestTime: row.digestTime,
    };
  }
}
