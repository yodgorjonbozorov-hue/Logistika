import { ChatMessageKind } from '@prisma/client';
import { UserRole, type CurrentUserPayload } from 'shared';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { ChatService } from './chat.service';

const DRIVER: CurrentUserPayload = {
  userId: 'driver-user',
  companyId: 'company-a',
  role: UserRole.DRIVER,
} as CurrentUserPayload;

const MESSAGES = [
  {
    id: 'm2',
    tripId: 't1',
    senderId: 'driver-user',
    kind: ChatMessageKind.TEXT,
    body: 'Chegarada turibman',
    fileId: null,
    readAt: null,
    createdAt: new Date('2026-08-16T11:00:00Z'),
  },
  {
    id: 'm1',
    tripId: 't1',
    senderId: 'user-1',
    kind: ChatMessageKind.TEXT,
    body: 'Qayerdasiz?',
    fileId: null,
    readAt: new Date('2026-08-16T10:31:00Z'),
    createdAt: new Date('2026-08-16T10:30:00Z'),
  },
];

function setup(options: { trip?: { driverId: string | null } | null; driverId?: string } = {}) {
  const { prisma, db, forCompany } = createTenantDbMock([
    'trip',
    'driver',
    'user',
    'chatMessage',
    'storedFile',
  ]);
  db.trip!.findFirst!.mockResolvedValue(
    options.trip === undefined ? { driverId: 'd1' } : options.trip,
  );
  db.driver!.findFirst!.mockResolvedValue({ id: options.driverId ?? 'd1' });
  db.chatMessage!.findMany!.mockResolvedValue(MESSAGES);
  db.chatMessage!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'm3', readAt: null, createdAt: new Date(), ...data }),
  );
  db.chatMessage!.updateMany!.mockResolvedValue({ count: 1 });
  db.chatMessage!.count!.mockResolvedValue(1);
  db.user!.findMany!.mockResolvedValue([
    { id: 'user-1', fullName: 'Nodira (logist)' },
    { id: 'driver-user', fullName: 'Alisher' },
  ]);
  db.storedFile!.findFirst!.mockResolvedValue({ id: 'f1' });

  return { service: new ChatService(prisma), db, forCompany };
}

describe('ChatService.list', () => {
  it('reads oldest first, with the sender named and own messages marked', async () => {
    const { service } = setup();

    const messages = await service.list(ACTOR, 't1');

    expect(messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(messages[0]).toMatchObject({ senderName: 'Nodira (logist)', mine: true });
    expect(messages[1]).toMatchObject({ senderName: 'Alisher', mine: false });
  });

  it('pages back through an older conversation', async () => {
    const { service, db } = setup();
    await service.list(ACTOR, 't1', new Date('2026-08-16T10:00:00Z'));
    expect(db.chatMessage!.findMany!.mock.calls[0][0].where.createdAt).toEqual({
      lt: new Date('2026-08-16T10:00:00Z'),
    });
  });

  it('scopes every read to the company', async () => {
    const { service, forCompany } = setup();
    await service.list(ACTOR, 't1');
    expect(forCompany).toHaveBeenCalledWith('company-a');
  });
});

describe('who may open a thread', () => {
  it('lets the driver of the trip in', async () => {
    const { service } = setup({ trip: { driverId: 'd1' }, driverId: 'd1' });
    expect(await service.list(DRIVER, 't1')).toHaveLength(2);
  });

  it("refuses a driver another driver's trip, without confirming it exists", async () => {
    const { service } = setup({ trip: { driverId: 'd-other' }, driverId: 'd1' });
    // NOT_FOUND, not FORBIDDEN: the answer must not reveal the trip.
    await expect(service.list(DRIVER, 't1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a driver with no driver profile', async () => {
    const { service, db } = setup();
    db.driver!.findFirst!.mockResolvedValue(null);
    await expect(service.list(DRIVER, 't1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets the office read any trip of its own company', async () => {
    const { service } = setup({ trip: { driverId: 'someone-else' } });
    expect(await service.list(ACTOR, 't1')).toHaveLength(2);
  });

  it('refuses a trip of another company — the scoped lookup finds nothing', async () => {
    const { service } = setup({ trip: null });
    await expect(service.list(ACTOR, 't1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('ChatService.post', () => {
  it('stores a text message without taking companyId from the caller', async () => {
    const { service, db } = setup();

    const message = await service.post(ACTOR, 't1', { body: '  Yo‘lda  ' });

    expect(message.mine).toBe(true);
    const data = db.chatMessage!.create!.mock.calls[0][0].data;
    expect(data.body).toBe('Yo‘lda');
    expect(data.senderId).toBe('user-1');
    expect(data.companyId).toBeUndefined();
  });

  it('refuses an empty text message', async () => {
    const { service, db } = setup();
    await expect(service.post(ACTOR, 't1', { body: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(db.chatMessage!.create).not.toHaveBeenCalled();
  });

  it('refuses a photo or voice message with no file', async () => {
    const { service } = setup();
    await expect(
      service.post(ACTOR, 't1', { kind: ChatMessageKind.PHOTO, body: 'qarang' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses an attachment that is not a file of this company', async () => {
    const { service, db } = setup();
    db.storedFile!.findFirst!.mockResolvedValue(null);
    await expect(
      service.post(ACTOR, 't1', { kind: ChatMessageKind.VOICE, fileId: 'f-someone-else' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('accepts a voice note with a file of its own', async () => {
    const { service } = setup();
    const message = await service.post(ACTOR, 't1', {
      kind: ChatMessageKind.VOICE,
      fileId: 'f1',
    });
    expect(message.kind).toBe(ChatMessageKind.VOICE);
    expect(message.fileId).toBe('f1');
  });
});

describe('read state', () => {
  it('marks only the other side messages read', async () => {
    const { service, db } = setup();

    expect(await service.markRead(ACTOR, 't1')).toEqual({ read: 1 });
    expect(db.chatMessage!.updateMany!.mock.calls[0][0].where).toMatchObject({
      tripId: 't1',
      readAt: null,
      NOT: { senderId: 'user-1' },
    });
  });

  it('counts only what the reader has not read', async () => {
    const { service, db } = setup();
    expect(await service.unreadCount(ACTOR, 't1')).toEqual({ unread: 1 });
    expect(db.chatMessage!.count!.mock.calls[0][0].where.NOT).toEqual({ senderId: 'user-1' });
  });

  it('is refused for a trip the user may not open', async () => {
    const { service } = setup({ trip: { driverId: 'd-other' }, driverId: 'd1' });
    await expect(service.markRead(DRIVER, 't1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
