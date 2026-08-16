// AI-2 (TZ §8.3): a photographed document becomes a *proposal*, never a record.
// Money arrives as tiyin in decimal strings, litres as centilitres — the same
// wire units the rest of the API uses.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

// ---------- AI-4 anomalies (TZ §8.5) ----------

export type AiInsightSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AiInsightStatus = 'NEW' | 'REVIEWED' | 'CONFIRMED' | 'FALSE_POSITIVE' | 'RESOLVED';

export interface AiInsight {
  id: string;
  type: string;
  severity: AiInsightSeverity;
  locale: string;
  /** Free text: the numbers come from code, the wording from AI (or the catalogue). */
  title: string;
  description: string;
  recommendation: string | null;
  relatedType: string | null;
  relatedId: string | null;
  estimatedLoss: string | null;
  status: AiInsightStatus;
  createdAt: string;
}

export function useInsights() {
  return useQuery({
    queryKey: ['ai', 'insights'],
    queryFn: () => api<AiInsight[]>('/ai/insights').then((r) => r.data),
    refetchInterval: 5 * 60_000,
  });
}

/** The boss's verdict; FALSE_POSITIVE is what measures the detector (TZ §8.10). */
export function useSetInsightStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: AiInsightStatus }) =>
      api<AiInsight>(`/ai/insights/${id}/status`, { method: 'PATCH', body: { status } }).then(
        (r) => r.data,
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ai', 'insights'] }),
  });
}

// ---------- AI-3 the boss asks (TZ §8.4) ----------

export type ChartType = 'none' | 'bar' | 'line' | 'pie';

export interface ChatReply {
  answer: string;
  chart: ChartType;
  /** Which prepared query the figures came from — shown so the answer is checkable. */
  source: { function: string; from: string; to: string; rowCount: number };
  data: unknown;
  requestIds: string[];
}

export function useAskAi() {
  return useMutation({
    mutationFn: (question: string) =>
      api<ChatReply>('/ai/chat', { method: 'POST', body: { question } }).then((r) => r.data),
  });
}
