import { Injectable } from '@nestjs/common';
import type { AiSettings, Prisma } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateSettingsDto } from './dto/settings.dto';

/** TZ §8.10 defaults, used until a company saves its own settings. */
export const DEFAULT_SETTINGS = {
  fuelDeviationThresholdBp: 700, // 7%
  idleAlertHours: 2,
  routeDeviationKm: 20,
  digestTime: '20:00',
  voiceEnabled: true,
  ocrEnabled: true,
  chatEnabled: true,
  anomalyEnabled: true,
  monthlyLimitMicroUsd: 50_000_000n, // $50/month
} as const;

/** What the deterministic checks read — fuel, idle, route deviation, digest. */
export interface CompanyThresholds {
  fuelDeviationThresholdBp: number;
  idleAlertHours: number;
  routeDeviationKm: number;
  digestTime: string;
}

/** Everything the W-11 settings screen shows. */
export interface CompanySettings extends CompanyThresholds {
  voiceEnabled: boolean;
  ocrEnabled: boolean;
  chatEnabled: boolean;
  anomalyEnabled: boolean;
  /** Spend cap and this month's usage, both micro-USD (TZ §8.11). */
  monthlyLimitMicroUsd: bigint;
  currentUsageMicroUsd: bigint;
  usageMonth: string;
}

function thresholdsOf(row: AiSettings | null): CompanyThresholds {
  return {
    fuelDeviationThresholdBp:
      row?.fuelDeviationThresholdBp ?? DEFAULT_SETTINGS.fuelDeviationThresholdBp,
    idleAlertHours: row?.idleAlertHours ?? DEFAULT_SETTINGS.idleAlertHours,
    routeDeviationKm: row?.routeDeviationKm ?? DEFAULT_SETTINGS.routeDeviationKm,
    digestTime: row?.digestTime ?? DEFAULT_SETTINGS.digestTime,
  };
}

function settingsOf(row: AiSettings | null): CompanySettings {
  return {
    ...thresholdsOf(row),
    voiceEnabled: row?.voiceEnabled ?? DEFAULT_SETTINGS.voiceEnabled,
    ocrEnabled: row?.ocrEnabled ?? DEFAULT_SETTINGS.ocrEnabled,
    chatEnabled: row?.chatEnabled ?? DEFAULT_SETTINGS.chatEnabled,
    anomalyEnabled: row?.anomalyEnabled ?? DEFAULT_SETTINGS.anomalyEnabled,
    monthlyLimitMicroUsd: row?.monthlyLimitMicroUsd ?? DEFAULT_SETTINGS.monthlyLimitMicroUsd,
    currentUsageMicroUsd: row?.currentUsageMicroUsd ?? 0n,
    usageMonth: row?.usageMonth ?? '',
  };
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The thresholds the checks run on. The row is created lazily — until a
   * company saves anything, every check runs on the TZ defaults.
   */
  async thresholds(companyId: string): Promise<CompanyThresholds> {
    return thresholdsOf(await this.prisma.forCompany(companyId).aiSettings.findFirst());
  }

  /** W-11 view: thresholds, AI switches and the spend cap in one object. */
  async settings(companyId: string): Promise<CompanySettings> {
    return settingsOf(await this.prisma.forCompany(companyId).aiSettings.findFirst());
  }

  /**
   * Thresholds are the control itself: lowering the fuel limit silences the
   * overrun alert, so the change is audited like any other (docs/SECURITY.md F-5).
   */
  async update(actor: CurrentUserPayload, dto: UpdateSettingsDto): Promise<CompanySettings> {
    const companyId = actor.companyId as string;
    const db = this.prisma.forCompany(companyId);
    const { monthlyLimitUsd, ...rest } = dto;
    const data = {
      ...rest,
      // The screen speaks whole dollars; storage is micro-USD (no float money).
      ...(monthlyLimitUsd === undefined
        ? {}
        : { monthlyLimitMicroUsd: BigInt(monthlyLimitUsd) * 1_000_000n }),
    };

    const existing = await db.aiSettings.findFirst();
    const row = existing
      ? await db.aiSettings.update({ where: { id: existing.id }, data })
      : // companyId is stamped by the tenant extension, never taken from input.
        await db.aiSettings.create({ data: data as Prisma.AiSettingsUncheckedCreateInput });
    this.audit.record(actor, existing ? 'UPDATE' : 'CREATE', 'CompanySettings', row, existing);
    return settingsOf(row);
  }
}
