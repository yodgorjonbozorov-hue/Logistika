import { Currency, ExpenseCategory } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { OCR_DOC_TYPES, OCR_TOOL, parseOcr } from './ocr.prompt';

const FUEL_RECEIPT = {
  doc_type: 'fuel_receipt',
  date: '2026-08-12T10:14:00Z',
  currency: 'UZS',
  total_amount: 3_600_000,
  liters: 300,
  price_per_liter: 12_000,
  vendor: 'AZS Jizzax',
  location: 'Jizzax',
  confidence: 0.94,
};

describe('parseOcr', () => {
  it("converts so'm to tiyin and litres to centilitres", () => {
    const fields = parseOcr(FUEL_RECEIPT);
    expect(fields.totalAmount).toBe(360_000_000n);
    expect(fields.pricePerLiter).toBe(1_200_000n);
    expect(fields.litersCl).toBe(30_000n);
    expect(fields.currency).toBe(Currency.UZS);
    expect(fields.confidenceBp).toBe(9400);
  });

  it('keeps the fractional part of an amount exact', () => {
    const fields = parseOcr({ ...FUEL_RECEIPT, total_amount: 3_600_000.5, liters: 300.75 });
    expect(fields.totalAmount).toBe(360_000_050n);
    expect(fields.litersCl).toBe(30_075n);
  });

  it('suggests a category from the document type but decides nothing else', () => {
    expect(parseOcr(FUEL_RECEIPT).suggestedCategory).toBe(ExpenseCategory.FUEL);
    expect(parseOcr({ doc_type: 'fine', confidence: 0.9 }).suggestedCategory).toBe(
      ExpenseCategory.FINE,
    );
    expect(parseOcr({ doc_type: 'cmr', confidence: 0.9 }).suggestedCategory).toBeNull();
  });

  it('leaves absent fields null instead of inventing them', () => {
    const fields = parseOcr({ doc_type: 'other', confidence: 0.8, total_amount: null, vendor: '' });
    expect(fields.totalAmount).toBeNull();
    expect(fields.vendor).toBeNull();
    expect(fields.date).toBeNull();
    // Currency is the only assumption, and it is the company's own.
    expect(fields.currency).toBe(Currency.UZS);
  });

  it('reads a waybill and an odometer photo', () => {
    const waybill = parseOcr({
      doc_type: 'waybill',
      document_number: 'TTN-4471',
      cargo_name: 'Paxta tolasi',
      cargo_weight_kg: 21_500,
      sender: 'Agro Invest',
      receiver: 'Textile MSK',
      confidence: 0.88,
    });
    expect(waybill.cargoName).toBe('Paxta tolasi');
    expect(waybill.cargoWeightKg).toBe(21_500);

    expect(parseOcr({ doc_type: 'odometer', odometer: 412_309, confidence: 0.99 }).odometer).toBe(
      412_309,
    );
  });

  it('rejects an answer that is not one of the known documents', () => {
    expect(() => parseOcr({ doc_type: 'passport', confidence: 0.9 })).toThrow(AppException);
    expect(() => parseOcr({ confidence: 0.9 })).toThrow(AppException);
    expect(() => parseOcr('a receipt for 300 litres')).toThrow(AppException);
  });

  it('rejects a negative or absurd amount', () => {
    expect(() => parseOcr({ ...FUEL_RECEIPT, total_amount: -100 })).toThrow(AppException);
    expect(() => parseOcr({ ...FUEL_RECEIPT, liters: 1e9 })).toThrow(AppException);
  });

  it('rejects an unreadable date rather than guessing one', () => {
    expect(() => parseOcr({ ...FUEL_RECEIPT, date: '12-avgust' })).toThrow(AppException);
  });
});

describe('OCR_TOOL', () => {
  it('offers exactly the document types the parser accepts', () => {
    const schema = OCR_TOOL.schema as { properties: { doc_type: { enum: string[] } } };
    expect(schema.properties.doc_type.enum).toEqual([...OCR_DOC_TYPES]);
  });

  it('asks for a confidence on every reading', () => {
    expect((OCR_TOOL.schema as { required: string[] }).required).toContain('confidence');
  });
});
