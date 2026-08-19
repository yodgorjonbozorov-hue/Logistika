import { bpToPercent, canonicalNumber, FactSheetBuilder, renderFacts, tiyinToSom } from './facts';
import { verifyAnswer } from './verify';

const NBSP = '\u00A0';

describe('tiyinToSom', () => {
  it('converts tiyin to grouped so’m', () => {
    expect(tiyinToSom('2300000000')).toBe(`23${NBSP}000${NBSP}000`);
    expect(tiyinToSom('900000000')).toBe(`9${NBSP}000${NBSP}000`);
    expect(tiyinToSom('0')).toBe('0');
  });

  it('keeps the tiyin part when there is one', () => {
    expect(tiyinToSom('378188')).toBe(`3${NBSP}781,88`);
    expect(tiyinToSom('1')).toBe('0,01');
  });

  it('keeps a loss negative', () => {
    expect(tiyinToSom('-200000')).toBe(`-2${NBSP}000`);
  });

  it('is exact past Number.MAX_SAFE_INTEGER', () => {
    // A double would render this as 90071992547409.92
    expect(tiyinToSom('9007199254740993')).toBe(`90${NBSP}071${NBSP}992${NBSP}547${NBSP}409,93`);
  });

  it('returns null rather than guessing at rubbish', () => {
    expect(tiyinToSom(null)).toBeNull();
    expect(tiyinToSom('')).toBeNull();
    expect(tiyinToSom('abc')).toBeNull();
  });
});

describe('bpToPercent', () => {
  it('renders basis points', () => {
    expect(bpToPercent(6696)).toBe('67,0 %');
    expect(bpToPercent(6696, 2)).toBe('66,96 %');
    expect(bpToPercent(6696, 0)).toBe('67 %');
    expect(bpToPercent(-2500, 0)).toBe('-25 %');
    expect(bpToPercent(0)).toBe('0,0 %');
  });

  it('returns null for an unknown ratio instead of 0 %', () => {
    expect(bpToPercent(null)).toBeNull();
    expect(bpToPercent(undefined)).toBeNull();
    expect(bpToPercent(Number.NaN)).toBeNull();
  });
});

describe('canonicalNumber', () => {
  it('treats every way of writing the same figure as the same figure', () => {
    const canonical = canonicalNumber('23000000');
    expect(canonicalNumber(`23${NBSP}000${NBSP}000`)).toBe(canonical);
    expect(canonicalNumber('23 000 000')).toBe(canonical);
    expect(canonicalNumber('23,000,000')).toBe(canonical);
  });

  it('normalises the decimal separator and trailing zeros', () => {
    expect(canonicalNumber('66,96')).toBe(canonicalNumber('66.96'));
    expect(canonicalNumber('1300,50')).toBe(canonicalNumber('1300.5'));
  });

  it('rejects things that are not numbers', () => {
    expect(canonicalNumber('abc')).toBe('');
    expect(canonicalNumber('1.2.3')).toBe('');
  });
});

describe('FactSheetBuilder', () => {
  it('registers every number it formats as permitted', () => {
    const sheet = new FactSheetBuilder('2026-08')
      .addSom('revenue', '2300000000')
      .addPercent('marginBp', 6696)
      .addCount('trips', 4)
      .addText('topRoute', 'Toshkent-Samarqand')
      .build();

    expect(sheet.allowedNumbers.has('23000000')).toBe(true);
    expect(sheet.allowedNumbers.has('67')).toBe(true);
    expect(sheet.allowedNumbers.has('4')).toBe(true);
    // A route name must never widen the set of quotable figures.
    expect(sheet.facts.find((f) => f.key === 'topRoute')?.unit).toBe('text');
  });

  it('skips a value the finance layer could not compute', () => {
    const sheet = new FactSheetBuilder('2026-08')
      .addSom('costPerKm', null)
      .addPercent('deviationBp', null)
      .build();
    expect(sheet.facts).toEqual([]);
  });

  it('reports an all-zero period as empty', () => {
    const sheet = new FactSheetBuilder('2026-08')
      .addSom('revenue', '0')
      .addCount('trips', 0)
      .build();
    expect(sheet.empty).toBe(true);
  });

  it('is not empty once a single figure is non-zero', () => {
    const sheet = new FactSheetBuilder('2026-08')
      .addSom('revenue', '0')
      .addCount('trips', 1)
      .build();
    expect(sheet.empty).toBe(false);
  });

  it('renders the block the model is shown', () => {
    const sheet = new FactSheetBuilder('2026-08').addSom('revenue', '900000000').build();
    expect(renderFacts(sheet)).toBe(`revenue: 9${NBSP}000${NBSP}000 so'm`);
  });
});

describe('verifyAnswer', () => {
  const period = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-09-01T00:00:00Z') };
  const sheet = new FactSheetBuilder('2026-08')
    .addSom('revenue', '900000000')
    .addSom('profit', '600000000')
    .addPercent('marginBp', 6667)
    .addCount('trips', 3)
    .build();

  it('accepts an answer that only quotes the facts', () => {
    const answer = `Bu oy daromad 9${NBSP}000${NBSP}000 so'm, sof foyda 6${NBSP}000${NBSP}000 so'm (66,7 %). Jami 3 ta reys.`;
    expect(verifyAnswer(answer, sheet, 'Bu oy qancha foyda?', period)).toEqual({
      ok: true,
      unknown: [],
    });
  });

  it('accepts the same figures written with different separators', () => {
    const answer = "Daromad 9 000 000 so'm, foyda 6000000 so'm.";
    expect(verifyAnswer(answer, sheet, '', period).ok).toBe(true);
  });

  it('REJECTS a figure nobody computed', () => {
    // The plausible-looking hallucination: a number in the right ballpark.
    const answer = "Daromad 9 000 000 so'm, xarajat 2 750 000 so'm.";
    const result = verifyAnswer(answer, sheet, '', period);
    expect(result.ok).toBe(false);
    expect(result.unknown).toContain('2750000');
  });

  it('rejects an invented percentage', () => {
    expect(verifyAnswer('Rentabellik 82,4 %.', sheet, '', period).ok).toBe(false);
  });

  it('allows numbers the user themselves typed', () => {
    const answer = "Oxirgi 45 kun uchun daromad 9 000 000 so'm.";
    expect(verifyAnswer(answer, sheet, 'oxirgi 45 kunda qancha?', period).ok).toBe(true);
    // …but only because the question contained it.
    expect(verifyAnswer(answer, sheet, 'qancha?', period).ok).toBe(false);
  });

  it('allows the year and month of the period under discussion', () => {
    expect(verifyAnswer('2026-yil 8-oy natijasi.', sheet, '', period).ok).toBe(true);
  });

  it('allows small integers that cannot misstate money', () => {
    expect(verifyAnswer('Eng foydali 3 ta yo’nalish: 1, 2, 3.', sheet, '', period).ok).toBe(true);
  });

  it('rejects a large number even when it looks like a count', () => {
    expect(verifyAnswer('Jami 4 200 ta reys bajarildi.', sheet, '', period).ok).toBe(false);
  });

  it('does not glue two numbers together across a sentence boundary', () => {
    // The period label ends in "…-31." and the next sentence starts with a
    // year: read as one token that is "-31.2026", which no fact sheet contains.
    const answer = "Davr: 2026-07-01 … 2026-07-31. 2026-07: daromad 9 000 000 so'm.";
    expect(verifyAnswer(answer, sheet, '', period)).toEqual({ ok: true, unknown: [] });
  });

  it('does not read the digits in a plate or a route name as figures', () => {
    // Found on a real deployment: naming vehicle 01D777DD in an otherwise
    // correct answer failed verification, because "01" and "777" are not
    // figures anybody computed — they are part of an identifier.
    const withNames = new FactSheetBuilder('2026-08')
      .addSom('revenue', '900000000')
      .addText('vehicle_1_plate', '01D777DD')
      .addText('route_1_name', 'M39 Toshkent-Samarqand')
      .build();

    const answer = `01D777DD mashinasi M39 Toshkent-Samarqand yo'nalishida 9${NBSP}000${NBSP}000 so'm daromad keltirdi.`;
    expect(verifyAnswer(answer, withNames, '', period)).toEqual({ ok: true, unknown: [] });
  });

  it('still catches an invented figure in a sentence that also names a vehicle', () => {
    const withNames = new FactSheetBuilder('2026-08')
      .addSom('revenue', '900000000')
      .addText('vehicle_1_plate', '01D777DD')
      .build();
    const answer = "01D777DD mashinasi 12 345 678 so'm daromad keltirdi.";
    expect(verifyAnswer(answer, withNames, '', period).ok).toBe(false);
  });
});
