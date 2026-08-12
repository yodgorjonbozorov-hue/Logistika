import type { AlertsService } from '../alerts/alerts.service';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { DocumentsService } from './documents.service';

const DAY = 24 * 60 * 60 * 1000;

describe('DocumentsService', () => {
  function setup() {
    const mock = createTenantDbMock(['document', 'vehicle', 'driver']);
    const alerts = { raise: jest.fn().mockResolvedValue(null) };
    (mock.prisma as unknown as Record<string, unknown>).company = {
      findMany: jest.fn().mockResolvedValue([{ id: 'company-a' }]),
    };
    const service = new DocumentsService(mock.prisma, alerts as unknown as AlertsService);
    return { service, db: mock.db, alerts };
  }

  describe('expiring', () => {
    it('merges documents, vehicle expiries and driver licenses, soonest first', async () => {
      const { service, db } = setup();
      const now = Date.now();
      db.document!.findMany!.mockResolvedValue([
        {
          ownerType: 'TRIP',
          ownerId: 't-1',
          docType: 'CMR',
          docNumber: 'CMR-77',
          expiryDate: new Date(now + 10 * DAY),
        },
      ]);
      db.vehicle!.findMany!.mockResolvedValue([
        {
          id: 'v-1',
          plateNumber: '01 A 123 AA',
          insuranceExpiry: new Date(now + 2 * DAY),
          techInspectionExpiry: new Date(now + 40 * DAY), // outside window
        },
      ]);
      db.driver!.findMany!.mockResolvedValue([
        { id: 'd-1', fullName: 'Alisher A.', licenseExpiry: new Date(now + 6 * DAY) },
      ]);

      const items = await service.expiring(ACTOR, 15);
      expect(items.map((i) => i.source)).toEqual([
        'VEHICLE_INSURANCE',
        'DRIVER_LICENSE',
        'DOCUMENT',
      ]);
      expect(items[0]!.label).toBe('01 A 123 AA');
      expect(items[0]!.daysLeft).toBe(2);
    });
  });

  describe('sendExpiryReminders cron', () => {
    it('raises DOC_EXPIRY only at the 15/7/1 marks or when overdue', async () => {
      const { service, db, alerts } = setup();
      const now = Date.now();
      db.document!.findMany!.mockResolvedValue([
        {
          ownerType: 'TRIP',
          ownerId: 'at-7',
          docType: 'CMR',
          docNumber: null,
          expiryDate: new Date(now + 7 * DAY),
        },
        {
          ownerType: 'TRIP',
          ownerId: 'at-10',
          docType: 'CMR',
          docNumber: null,
          expiryDate: new Date(now + 10 * DAY),
        },
        {
          ownerType: 'COMPANY',
          ownerId: 'gone',
          docType: 'license',
          docNumber: null,
          expiryDate: new Date(now - 3 * DAY),
        },
      ]);
      db.vehicle!.findMany!.mockResolvedValue([]);
      db.driver!.findMany!.mockResolvedValue([]);

      await service.sendExpiryReminders();
      const raisedFor = alerts.raise.mock.calls.map(
        (call: [string, { relatedId: string }]) => call[1].relatedId,
      );
      expect(raisedFor).toEqual(['gone', 'at-7']); // sorted by daysLeft; 10-day doc skipped
      expect(alerts.raise.mock.calls[0][1].params.daysLeft).toBe(0); // overdue clamps to 0
    });
  });
});
