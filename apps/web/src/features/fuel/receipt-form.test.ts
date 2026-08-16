import { describe, expect, it } from 'vitest';
import type { OcrProposal } from '../../shared/api/ai';
import { diffForm, emptyFuelForm, formFromProposal, litresInput } from './receipt-form';

const PROPOSAL = {
  requestId: 'req-1',
  fileId: 'f1',
  confidenceBp: 9400,
  checks: [],
  fields: {
    docType: 'fuel_receipt',
    date: '2026-08-12T10:14:00.000Z',
    currency: 'UZS',
    totalAmount: '360000000',
    litersCl: '30000',
    pricePerLiter: '1200000',
    vendor: 'AZS Jizzax',
    location: 'Jizzax',
    odometer: 412309,
    documentNumber: null,
    cargoName: null,
    cargoWeightKg: null,
    sender: null,
    receiver: null,
    reason: null,
    comment: null,
    confidenceBp: 9400,
    suggestedCategory: 'FUEL',
  },
} as OcrProposal;

describe('litresInput', () => {
  it('turns centilitres into what a person types, without a float', () => {
    expect(litresInput('30000')).toBe('300');
    expect(litresInput('30050')).toBe('300.5');
    expect(litresInput('30055')).toBe('300.55');
    expect(litresInput('7')).toBe('0.07');
  });
});

describe('formFromProposal', () => {
  it('fills the form with the reading, in the units the inputs use', () => {
    const filled = formFromProposal(emptyFuelForm(), PROPOSAL);
    expect(filled.liters).toBe('300');
    expect(filled.pricePerLiter).toBe('12000'); // so'm, not tiyin
    expect(filled.stationName).toBe('AZS Jizzax');
    expect(filled.odometer).toBe('412309');
    expect(filled.refuelTime).toBe('2026-08-12');
  });

  it('never overwrites what the user already chose or typed', () => {
    const current = { ...emptyFuelForm(), vehicleId: 'v1', stationName: 'Mening AZS' };
    const blank = {
      ...PROPOSAL,
      fields: { ...PROPOSAL.fields, vendor: null, odometer: null, litersCl: null, date: null },
    };
    const filled = formFromProposal(current, blank);
    expect(filled.vehicleId).toBe('v1');
    expect(filled.stationName).toBe('Mening AZS');
    expect(filled.liters).toBe('');
    expect(filled.refuelTime).toBe(current.refuelTime);
  });
});

describe('diffForm', () => {
  it('reports only what the user corrected before saving', () => {
    const proposed = formFromProposal(emptyFuelForm(), PROPOSAL);
    const submitted = { ...proposed, liters: '305', vehicleId: 'v1' };
    expect(diffForm(proposed, submitted)).toEqual({ liters: '305', vehicleId: 'v1' });
  });

  it('reports nothing when the reading was accepted as it came', () => {
    const proposed = formFromProposal(emptyFuelForm(), PROPOSAL);
    expect(diffForm(proposed, { ...proposed })).toBeUndefined();
  });
});
