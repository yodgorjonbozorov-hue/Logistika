import { Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import type { AlertView, AlertsView, CurrentUserPayload } from 'shared';
import { AlertSeverity } from 'shared';
import { PrismaService } from '../../prisma/prisma.service';
import { FuelService } from '../fuel/fuel.service';
import { TrackingService } from '../tracking/tracking.service';
import {
  countBySeverity,
  documentAlerts,
  fleetAlerts,
  fuelAlerts,
  paymentAlerts,
  serviceAlerts,
  sortAlerts,
  type ExpiringDocument,
} from './alerts.rules';

/**
 * W-10 «Ogohlantirishlar markazi». Everything is derived on read from data the
 * system already holds — no alert table to drift out of step with reality, and
 * no background job needed for the screen to be correct. (Push delivery over
 * Telegram/FCM is a separate concern, stage 8.)
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fuel: FuelService,
    private readonly tracking: TrackingService,
  ) {}

  async list(actor: CurrentUserPayload, now = new Date()): Promise<AlertsView> {
    const db = this.prisma.forCompany(actor.companyId);

    const [vehicles, drivers, documents, incomes, live, fuelControl] = await Promise.all([
      db.vehicle.findMany({
        where: { isActive: true },
        select: {
          id: true,
          plateNumber: true,
          insuranceExpiry: true,
          techInspectionExpiry: true,
          currentOdometer: true,
          nextServiceOdometer: true,
        },
      }),
      db.driver.findMany({
        where: { isActive: true },
        select: { id: true, fullName: true, licenseExpiry: true },
      }),
      db.document.findMany({
        where: { expiryDate: { not: null } },
        select: { id: true, ownerType: true, ownerId: true, docType: true, expiryDate: true },
      }),
      db.income.findMany({
        where: {
          status: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL, PaymentStatus.OVERDUE] },
        },
        select: {
          id: true,
          amount: true,
          status: true,
          createdAt: true,
          clientId: true,
          client: { select: { name: true, paymentTermsDays: true } },
        },
      }),
      this.tracking.live(actor),
      this.fuel.control(actor, {}),
    ]);

    const vehicleNames = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.plateNumber]));
    const driverNames = new Map(drivers.map((driver) => [driver.id, driver.fullName]));

    const expiring: ExpiringDocument[] = [];
    for (const vehicle of vehicles) {
      if (vehicle.insuranceExpiry) {
        expiring.push({
          docType: 'insurance',
          expiryDate: vehicle.insuranceExpiry,
          subject: vehicle.plateNumber,
          entity: { kind: 'vehicle', id: vehicle.id },
        });
      }
      if (vehicle.techInspectionExpiry) {
        expiring.push({
          docType: 'techInspection',
          expiryDate: vehicle.techInspectionExpiry,
          subject: vehicle.plateNumber,
          entity: { kind: 'vehicle', id: vehicle.id },
        });
      }
    }
    for (const driver of drivers) {
      if (driver.licenseExpiry) {
        expiring.push({
          docType: 'license',
          expiryDate: driver.licenseExpiry,
          subject: driver.fullName,
          entity: { kind: 'driver', id: driver.id },
        });
      }
    }
    for (const document of documents) {
      if (!document.expiryDate) continue;
      const isDriver = document.ownerType === 'DRIVER';
      const subject = isDriver
        ? driverNames.get(document.ownerId)
        : vehicleNames.get(document.ownerId);
      expiring.push({
        docType: document.docType,
        expiryDate: document.expiryDate,
        subject: subject ?? document.docType,
        entity: { kind: isDriver ? 'driver' : 'vehicle', id: document.ownerId },
      });
    }

    const activeTripVehicles = new Set(
      live.filter((vehicle) => vehicle.trip !== null).map((vehicle) => vehicle.vehicleId),
    );

    const items: AlertView[] = sortAlerts([
      ...documentAlerts(expiring, now),
      ...serviceAlerts(
        vehicles.map((vehicle) => ({
          vehicleId: vehicle.id,
          plateNumber: vehicle.plateNumber,
          currentOdometer: vehicle.currentOdometer,
          nextServiceOdometer: vehicle.nextServiceOdometer,
        })),
      ),
      ...paymentAlerts(
        incomes.map((income) => ({
          id: income.id,
          amount: income.amount,
          status: income.status,
          createdAt: income.createdAt,
          clientId: income.clientId,
          clientName: income.client?.name ?? null,
          paymentTermsDays: income.client?.paymentTermsDays ?? null,
        })),
        now,
      ),
      ...fleetAlerts(
        live.map((vehicle) => ({
          vehicleId: vehicle.vehicleId,
          plateNumber: vehicle.plateNumber,
          status: vehicle.status,
          lastPositionAt: vehicle.lastPosition?.recordedAt ?? null,
          deviationKm: vehicle.deviationKm,
          hasActiveTrip: activeTripVehicles.has(vehicle.vehicleId),
        })),
        now,
      ),
      ...fuelAlerts(fuelControl.rows),
    ]);

    const counts = countBySeverity(items);
    return {
      generatedAt: now.toISOString(),
      counts: {
        CRITICAL: counts[AlertSeverity.CRITICAL],
        WARNING: counts[AlertSeverity.WARNING],
        INFO: counts[AlertSeverity.INFO],
        total: items.length,
      },
      items,
    };
  }
}
