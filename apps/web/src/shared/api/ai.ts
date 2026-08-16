// AI-2 (TZ §8.3): a photographed document becomes a *proposal*, never a record.
// Money arrives as tiyin in decimal strings, litres as centilitres — the same
// wire units the rest of the API uses.
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, uploadFile } from './client';

export interface AiStatus {
  /** Usable right now — a key is configured and the monthly cap is not spent. */
  available: boolean;
  configured: boolean;
  month: string;
  usedMicroUsd: string;
  limitMicroUsd: string;
}

export const OCR_DOC_TYPES = [
  'fuel_receipt',
  'waybill',
  'cmr',
  'customs',
  'repair',
  'fine',
  'odometer',
  'other',
] as const;
export type OcrDocType = (typeof OCR_DOC_TYPES)[number];

export interface OcrCheck {
  code:
    | 'AMOUNT_MISMATCH'
    | 'DATE_OUT_OF_TRIP'
    | 'LOCATION_MISMATCH'
    | 'LOCATION_UNVERIFIED'
    | 'DUPLICATE_RECEIPT'
    | 'LOW_CONFIDENCE';
  severity: 'WARNING' | 'ERROR';
  params: Record<string, string | number>;
}

export interface OcrFields {
  docType: OcrDocType;
  date: string | null;
  currency: string;
  totalAmount: string | null;
  litersCl: string | null;
  pricePerLiter: string | null;
  vendor: string | null;
  location: string | null;
  odometer: number | null;
  documentNumber: string | null;
  cargoName: string | null;
  cargoWeightKg: number | null;
  sender: string | null;
  receiver: string | null;
  reason: string | null;
  comment: string | null;
  confidenceBp: number | null;
  suggestedCategory: string | null;
}

export interface OcrProposal {
  requestId: string;
  fileId: string;
  fields: OcrFields;
  checks: OcrCheck[];
  confidenceBp: number | null;
}

export interface StoredFile {
  id: string;
  mimeType: string;
}

export function useAiStatus() {
  return useQuery({
    queryKey: ['ai', 'status'],
    queryFn: () => api<AiStatus>('/ai/status').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}

export interface ScanInput {
  file: File;
  tripId?: string;
  vehicleId?: string;
  lat?: number;
  lng?: number;
}

/** Upload the photo, then have it read. Two calls, one action for the user. */
export function useScanDocument() {
  return useMutation({
    mutationFn: async ({ file, ...context }: ScanInput) => {
      const stored = await uploadFile<StoredFile>('/files/upload', file);
      const { data } = await api<OcrProposal>('/ai/ocr', {
        method: 'POST',
        body: { fileId: stored.id, ...context },
      });
      return data;
    },
  });
}

/**
 * Records that a person accepted the reading. `correctedData` is whatever they
 * changed first — it is how OCR accuracy gets measured (TZ §8.12), and it is
 * never applied to any table by the AI module itself.
 */
export function useConfirmAiRequest() {
  return useMutation({
    mutationFn: ({
      requestId,
      correctedData,
    }: {
      requestId: string;
      correctedData?: Record<string, unknown>;
    }) =>
      api(`/ai/requests/${requestId}/confirm`, {
        method: 'PATCH',
        body: { correctedData },
      }).then((r) => r.data),
  });
}
