import { AlertType } from 'shared';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import type { AiService } from './ai.service';
import { OcrService } from './ocr.service';
import { parseOcr } from './ocr.prompt';

const PHOTO = Buffer.from('a photo of a receipt');
const FUEL_RECEIPT = {
  doc_type: 'fuel_receipt',
  date: '2026-08-12T10:14:00Z',
  currency: 'UZS',
  total_amount: 3_600_000,
  liters: 300,
  price_per_liter: 12_000,
  vendor: 'AZS Jizzax',
  confidence: 0.94,
};

const TRIP = {
  id: 't1',
  vehicleId: 'v1',
  startedAt: new Date('2026-08-10T06:00:00Z'),
  finishedAt: new Date('2026-08-14T18:00:00Z'),
  loadingDate: null,
  unloadingDate: null,
};

function setup(
  options: { json?: Record<string, unknown>; duplicate?: { id: string } | null } = {},
) {
  const { prisma, db, forCompany } = createTenantDbMock(['trip', 'gpsTrack']);

  const sent: Record<string, unknown>[] = [];
  const run = jest.fn(async (opts: Record<string, unknown>) => {
    sent.push(opts);
    const parse = opts.parse as (raw: unknown, tool: string) => { confidenceBp: number | null };
    const data = parse(options.json ?? FUEL_RECEIPT, 'report_document');
    return { requestId: 'req-1', data, confidenceBp: data.confidenceBp, costMicroUsd: 2500n };
  });
  const previousReceipt = jest.fn().mockResolvedValue(options.duplicate ?? null);
  const ai = { run, previousReceipt } as unknown as AiService;

  const files = { read: jest.fn().mockResolvedValue({ body: PHOTO, mimeType: 'image/jpeg' }) };
  const alerts = { raise: jest.fn().mockResolvedValue(null) };
  const settings = { thresholds: jest.fn().mockResolvedValue({ routeDeviationKm: 20 }) };

  const service = new OcrService(prisma, ai, files as never, alerts as never, settings as never);
  return { service, db, forCompany, sent, files, alerts, previousReceipt };
}

function codes(checks: { code: string }[]): string[] {
  return checks.map((check) => check.code);
}

describe('OcrService.readDocument', () => {
  it('returns a proposal, and writes no fuel log or expense', async () => {
    const { service, db, sent } = setup();
    db.trip!.findFirst!.mockResolvedValue(TRIP);

    const proposal = await service.readDocument(ACTOR, { fileId: 'f1', tripId: 't1' });

    expect(proposal.requestId).toBe('req-1');
    expect(proposal.fields.totalAmount).toBe(360_000_000n);
    expect(proposal.fields.vendor).toBe('AZS Jizzax');
    expect(proposal.checks).toEqual([]);
    // Only reads: the tenant mock exposes trip and gpsTrack, both read-only here.
    expect(db.trip!.create).not.toHaveBeenCalled();
    expect(db.gpsTrack!.create).not.toHaveBeenCalled();
    // The photo itself is sent; the file id is what gets logged.
    expect(sent[0]).toMatchObject({ feature: 'OCR', inputRef: 'f1' });
  });

  it('sends the photo as base64 with a receipt hash for the duplicate check', async () => {
    const { service, sent } = setup();
    await service.readDocument(ACTOR, { fileId: 'f1' });

    const messages = sent[0]!.messages as { content: unknown[] }[];
    expect(messages[0]!.content[0]).toMatchObject({ type: 'image', source: { type: 'base64' } });
    expect(sent[0]!.receiptHash as string).toHaveLength(64);
  });

  it('refuses a PDF — Vision needs an image', async () => {
    const { service, files } = setup();
    files.read.mockResolvedValue({ body: PHOTO, mimeType: 'application/pdf' });
    await expect(service.readDocument(ACTOR, { fileId: 'f1' })).rejects.toMatchObject({
      code: 'FILE_TYPE_NOT_ALLOWED',
    });
  });

  it('reports a sum that does not match litres × price', async () => {
    const { service } = setup({ json: { ...FUEL_RECEIPT, total_amount: 4_000_000 } });
    const proposal = await service.readDocument(ACTOR, { fileId: 'f1' });
    expect(codes(proposal.checks)).toContain('AMOUNT_MISMATCH');
  });

  it('reports a receipt dated outside the trip', async () => {
    const { service, db } = setup({ json: { ...FUEL_RECEIPT, date: '2026-07-01T10:00:00Z' } });
    db.trip!.findFirst!.mockResolvedValue(TRIP);
    const proposal = await service.readDocument(ACTOR, { fileId: 'f1', tripId: 't1' });
    expect(codes(proposal.checks)).toContain('DATE_OUT_OF_TRIP');
  });

  it('compares the capture position with the vehicle GPS trail', async () => {
    const { service, db } = setup();
    db.trip!.findFirst!.mockResolvedValue(TRIP);
    db.gpsTrack!.findMany!.mockResolvedValue([
      { lat: 39.627, lng: 66.975, recordedAt: new Date('2026-08-12T10:20:00Z') },
    ]);

    const proposal = await service.readDocument(ACTOR, {
      fileId: 'f1',
      tripId: 't1',
      lat: 40.1158,
      lng: 67.842,
    });

    expect(codes(proposal.checks)).toContain('LOCATION_MISMATCH');
    expect(db.gpsTrack!.findMany!.mock.calls[0][0].where.vehicleId).toBe('v1');
  });

  it('alerts the boss when the same photo was already accepted', async () => {
    const { service, alerts } = setup({ duplicate: { id: 'req-old' } });

    const proposal = await service.readDocument(ACTOR, { fileId: 'f1' });

    expect(codes(proposal.checks)).toContain('DUPLICATE_RECEIPT');
    expect(alerts.raise).toHaveBeenCalledWith(
      'company-a',
      expect.objectContaining({
        type: AlertType.DUPLICATE_RECEIPT,
        messageKey: 'alerts.duplicateReceipt.message',
      }),
    );
  });

  it('flags a blurred photo the model was unsure about', async () => {
    const { service } = setup({ json: { doc_type: 'fuel_receipt', confidence: 0.4 } });
    const proposal = await service.readDocument(ACTOR, { fileId: 'f1' });
    expect(codes(proposal.checks)).toEqual(['LOW_CONFIDENCE']);
  });

  it('reads the file through the tenant-scoped service, never a bare key', async () => {
    const { service, files } = setup();
    await service.readDocument(ACTOR, { fileId: 'f1' });
    expect(files.read).toHaveBeenCalledWith('company-a', 'f1');
  });

  it('cannot pull a trip of another company into the checks', async () => {
    const { service, db, forCompany } = setup();
    db.trip!.findFirst!.mockResolvedValue(null); // scoped lookup finds nothing

    const proposal = await service.readDocument(ACTOR, {
      fileId: 'f1',
      tripId: 'other-company-trip',
    });

    expect(forCompany).toHaveBeenCalledWith('company-a');
    // No trip in scope means no date check — never a check against foreign data.
    expect(codes(proposal.checks)).not.toContain('DATE_OUT_OF_TRIP');
  });
});

describe('the AI boundary (TZ §8.0 / §8.12)', () => {
  const WRITES = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'];

  it('touches the business tables with reads only, whatever the photo said', async () => {
    const { service, db } = setup({ duplicate: { id: 'req-old' } });
    db.trip!.findFirst!.mockResolvedValue(TRIP);
    db.gpsTrack!.findMany!.mockResolvedValue([
      { lat: 41.31, lng: 69.28, recordedAt: new Date('2026-08-12T10:05:00Z') },
    ]);

    await service.readDocument(ACTOR, { fileId: 'f1', tripId: 't1', lat: 41.31, lng: 69.28 });

    for (const [model, operations] of Object.entries(db)) {
      for (const write of WRITES) {
        expect([model, write, operations[write]!.mock.calls.length]).toEqual([model, write, 0]);
      }
    }
  });

  it('never asks the model for a decision it could turn into money', () => {
    // The proposal carries figures read off paper; what they mean for the books
    // (category, tiyin, checks) is decided by code — parseOcr is pure.
    const fields = parseOcr(FUEL_RECEIPT);
    expect(fields.suggestedCategory).toBe('FUEL');
    expect(fields.totalAmount).toBe(360_000_000n);
    expect(parseOcr(FUEL_RECEIPT)).toEqual(fields);
  });
});
