import type { AuditService } from '../audit/audit.service';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { CatalogueListDto } from '../../common/dto/catalogue.dto';
import { ClientsService } from './clients.service';

/**
 * Clients used to be hard-deleted (TASK-3.11).
 *
 * The foreign keys made that fail once a trip or an income pointed at the
 * client, which hid the real problem: it *succeeded* for a client with nothing
 * attached, and that row vanished — the audit `before` was the only remaining
 * trace that the counterparty had existed.
 */
describe('ClientsService', () => {
  const audit = {
    log: jest.fn(),
    logInTx: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  function setup(client: Record<string, unknown> = {}) {
    const { prisma, db } = createTenantDbMock(['client', 'trip']);
    db.client!.findUnique!.mockResolvedValue({
      id: 'c1',
      name: 'Uztex',
      balance: 0n,
      isActive: true,
      ...client,
    });
    db.client!.update!.mockResolvedValue({ id: 'c1', isActive: false });
    db.trip!.findFirst!.mockResolvedValue(null);
    return { service: new ClientsService(prisma, audit), db };
  }

  const list = (over: Partial<CatalogueListDto> = {}) =>
    Object.assign(new CatalogueListDto(), over);

  describe('deactivate', () => {
    it('retires the client instead of deleting the row', async () => {
      const { service, db } = setup();

      await service.deactivate(ACTOR, 'c1');

      expect(db.client!.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { isActive: false },
      });
      // The trips, invoices and ledger entries all still name this client.
      expect(db.client!.delete).not.toHaveBeenCalled();
    });

    it('records it as a deactivation, with both sides of the change', async () => {
      const { service } = setup();

      await service.deactivate(ACTOR, 'c1');

      expect(audit.logInTx).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'DEACTIVATE', entityType: 'Client' }),
      );
    });

    it('refuses while the client still owes money', async () => {
      const { service, db } = setup({ balance: -4_000_000n });

      // A retired client drops out of the list, and the debt goes with it —
      // the one number somebody has to keep chasing.
      await expect(service.deactivate(ACTOR, 'c1')).rejects.toMatchObject({
        code: 'RESOURCE_IN_USE',
        httpStatus: 409,
        details: { reason: 'balance', balance: '-4000000' },
      });
      expect(db.client!.update).not.toHaveBeenCalled();
    });

    it('refuses while the company owes the client', async () => {
      // An overpayment is money owed back; retiring it hides that too.
      const { service } = setup({ balance: 500_000n });
      await expect(service.deactivate(ACTOR, 'c1')).rejects.toMatchObject({
        details: { reason: 'balance' },
      });
    });

    it('refuses while a trip for the client is planned or under way', async () => {
      const { service, db } = setup();
      db.trip!.findFirst!.mockResolvedValue({
        id: 't9',
        tripNumber: 'TR-2026-0041',
        status: 'IN_PROGRESS',
      });

      await expect(service.deactivate(ACTOR, 'c1')).rejects.toMatchObject({
        code: 'RESOURCE_IN_USE',
        details: { reason: 'trip', tripNumber: 'TR-2026-0041' },
      });
    });

    it('allows it once the balance is settled and nothing is running', async () => {
      const { service, db } = setup();

      await service.deactivate(ACTOR, 'c1');

      expect(db.trip!.findFirst!.mock.calls[0][0].where).toEqual({
        clientId: 'c1',
        status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
      });
    });

    it('reports a client from another tenant as missing', async () => {
      const { service, db } = setup();
      db.client!.findUnique!.mockResolvedValue(null);

      await expect(service.deactivate(ACTOR, 'someone-elses-client')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('list', () => {
    it('shows only the working set by default', async () => {
      const { service, db } = setup();

      await service.list(ACTOR, list());

      // A retired client left in every picker is a flag, not a soft delete.
      expect(db.client!.findMany!.mock.calls[0][0].where).toEqual({ isActive: true });
    });

    it('shows the archive when it is asked for', async () => {
      const { service, db } = setup();

      await service.list(ACTOR, list({ includeInactive: true }));

      expect(db.client!.findMany!.mock.calls[0][0].where).toEqual({ isActive: undefined });
    });

    it('counts the same set it lists', async () => {
      const { service, db } = setup();

      await service.list(ACTOR, list());

      // Counting everything while listing the active ones makes the last page
      // of the table empty.
      expect(db.client!.count!.mock.calls[0][0].where).toEqual({ isActive: true });
    });
  });
});
