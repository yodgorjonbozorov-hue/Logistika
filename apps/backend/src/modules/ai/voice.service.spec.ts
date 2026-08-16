import { Currency, ExpenseCategory, TripEventType } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { ACTOR } from '../../test-utils/tenant-db.mock';
import type { AiService } from './ai.service';
import type { TranscribeClient } from './transcribe.client';
import { VoiceService } from './voice.service';
import { parseVoice } from './voice.prompt';

/** The TZ §8.2 example, word for word. */
const SPOKEN = "Jizzaxda uch yuz litr quydim, to'rt million ikki yuz ming, chek bor";
const HEARD = {
  event_type: 'refuel',
  liters: 300,
  amount: 4_200_000,
  currency: 'UZS',
  location: 'Jizzax',
  category: 'fuel',
  comment: 'chek bor',
  confidence: 0.92,
};

function setup(options: { heard?: Record<string, unknown>; configured?: boolean } = {}) {
  const sent: Record<string, unknown>[] = [];
  const run = jest.fn(async (opts: Record<string, unknown>) => {
    sent.push(opts);
    const parse = opts.parse as (raw: unknown, tool: string) => { confidenceBp: number | null };
    const data = parse(options.heard ?? HEARD, 'report_voice_entry');
    return { requestId: 'req-1', data, confidenceBp: data.confidenceBp, costMicroUsd: 200n };
  });
  const ai = { run, available: true } as unknown as AiService;

  const files = {
    read: jest.fn().mockResolvedValue({ body: Buffer.from('audio'), mimeType: 'audio/mp4' }),
  };
  const transcriber = {
    configured: options.configured ?? true,
    transcribe: jest.fn().mockResolvedValue(SPOKEN),
  } as unknown as TranscribeClient;

  const service = new VoiceService(ai, files as never, transcriber);
  return { service, sent, files, transcriber };
}

describe('VoiceService.readNote', () => {
  it('turns a spoken refuel into a proposal, in the units the system uses', async () => {
    const { service } = setup();

    const proposal = await service.readNote(ACTOR, 'f1');

    expect(proposal.transcript).toBe(SPOKEN);
    expect(proposal.fields.litersCl).toBe(30_000n);
    expect(proposal.fields.amount).toBe(420_000_000n); // tiyin
    expect(proposal.fields.location).toBe('Jizzax');
    expect(proposal.fields.suggestedEvent).toBe(TripEventType.REFUEL);
    expect(proposal.fields.suggestedCategory).toBe(ExpenseCategory.FUEL);
    expect(proposal.needsRetry).toBe(false);
  });

  it('asks again below 0.7 confidence, as TZ §8.2 requires', async () => {
    const { service } = setup({ heard: { ...HEARD, confidence: 0.6 } });
    const proposal = await service.readNote(ACTOR, 'f1');
    expect(proposal.confidenceBp).toBe(6000);
    expect(proposal.needsRetry).toBe(true);
    // The reading is still returned — the driver may accept it deliberately.
    expect(proposal.fields.litersCl).toBe(30_000n);
  });

  it('asks again when the model reported no confidence at all', async () => {
    const { service } = setup({ heard: { event_type: 'other' } });
    expect((await service.readNote(ACTOR, 'f1')).needsRetry).toBe(true);
  });

  it('sends the transcript, not the audio, to the model', async () => {
    const { service, sent } = setup();
    await service.readNote(ACTOR, 'f1');
    expect(sent[0]!.messages).toEqual([{ role: 'user', content: SPOKEN }]);
    expect(sent[0]!.inputType).toBe('audio');
    expect(sent[0]!.inputRef).toBe('f1');
  });

  it('passes the language hint to the recogniser', async () => {
    const { service, transcriber } = setup();
    await service.readNote(ACTOR, 'f1', 'uz');
    expect((transcriber.transcribe as jest.Mock).mock.calls[0][0].language).toBe('uz');
  });

  it('refuses a photo — this endpoint reads audio', async () => {
    const { service, files } = setup();
    files.read.mockResolvedValue({ body: Buffer.from('x'), mimeType: 'image/jpeg' });
    await expect(service.readNote(ACTOR, 'f1')).rejects.toMatchObject({
      code: 'FILE_TYPE_NOT_ALLOWED',
    });
  });

  it('reads the file through the tenant-scoped service', async () => {
    const { service, files } = setup();
    await service.readNote(ACTOR, 'f1');
    expect(files.read).toHaveBeenCalledWith('company-a', 'f1');
  });

  it('reports itself unavailable without a recogniser', () => {
    expect(setup({ configured: false }).service.available).toBe(false);
    expect(setup().service.available).toBe(true);
  });
});

describe('parseVoice', () => {
  it('leaves what was not said null instead of guessing', () => {
    const fields = parseVoice({ event_type: 'breakdown', confidence: 0.8 });
    expect(fields.litersCl).toBeNull();
    expect(fields.amount).toBeNull();
    expect(fields.location).toBeNull();
    expect(fields.suggestedCategory).toBeNull();
    expect(fields.suggestedEvent).toBe(TripEventType.BREAKDOWN);
    expect(fields.currency).toBe(Currency.UZS);
  });

  it('maps every spoken event to a trip event, or to none deliberately', () => {
    expect(parseVoice({ event_type: 'rest', confidence: 1 }).suggestedEvent).toBe(
      TripEventType.REST,
    );
    expect(parseVoice({ event_type: 'other', confidence: 1 }).suggestedEvent).toBeNull();
  });

  it('rejects an event or category it does not know', () => {
    expect(() => parseVoice({ event_type: 'sing', confidence: 1 })).toThrow(AppException);
    expect(() => parseVoice({ event_type: 'expense', category: 'bribe', confidence: 1 })).toThrow(
      AppException,
    );
    expect(() => parseVoice({ confidence: 1 })).toThrow(AppException);
  });

  it('keeps a fractional amount exact', () => {
    const fields = parseVoice({ event_type: 'expense', amount: 12_500.75, confidence: 0.9 });
    expect(fields.amount).toBe(1_250_075n);
  });
});
