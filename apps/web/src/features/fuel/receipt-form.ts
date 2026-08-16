// Mapping between an AI-2 reading and the fuel form the user submits.
// Kept out of the page so the conversion — the part that decides which numbers
// a person ends up saving — can be tested on its own.
import type { OcrProposal } from '../../shared/api/ai';
import { tiyinToSom } from '../../shared/utils/money';

export interface FuelForm {
  vehicleId: string;
  liters: string;
  pricePerLiter: string;
  stationName: string;
  odometer: string;
  refuelTime: string;
}

/** A fresh empty form; today's date is read when the form opens, not at import. */
export function emptyFuelForm(): FuelForm {
  return {
    vehicleId: '',
    liters: '',
    pricePerLiter: '',
    stationName: '',
    odometer: '',
    refuelTime: new Date().toISOString().slice(0, 10),
  };
}

/** Centilitres on the wire → what the litres input should show ("300.5"). */
export function litresInput(centilitres: string): string {
  const value = BigInt(centilitres);
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  const fraction = (abs % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return `${sign}${abs / 100n}${fraction ? `.${fraction}` : ''}`;
}

/**
 * What AI-2 read, in the shape of the form the user is about to submit.
 * A field the reading left empty keeps whatever the user already typed — the
 * proposal fills gaps, it never wipes their own input.
 */
export function formFromProposal(current: FuelForm, proposal: OcrProposal): FuelForm {
  const { fields } = proposal;
  return {
    ...current,
    liters: fields.litersCl ? litresInput(fields.litersCl) : current.liters,
    pricePerLiter: fields.pricePerLiter ? tiyinToSom(fields.pricePerLiter) : current.pricePerLiter,
    stationName: fields.vendor ?? current.stationName,
    odometer: fields.odometer?.toString() ?? current.odometer,
    refuelTime: fields.date ? fields.date.slice(0, 10) : current.refuelTime,
  };
}

/** Fields the user changed after applying a reading (TZ §8.12 corrected_data). */
export function diffForm(
  proposed: FuelForm,
  submitted: FuelForm,
): Record<string, string> | undefined {
  const changed = Object.entries(submitted).filter(
    ([key, value]) => proposed[key as keyof FuelForm] !== value,
  );
  return changed.length > 0 ? Object.fromEntries(changed) : undefined;
}
