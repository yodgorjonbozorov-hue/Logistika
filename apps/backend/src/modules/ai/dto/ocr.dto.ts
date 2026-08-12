import { IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';

export class AnalyzeReceiptDto {
  @IsUUID()
  fileId!: string;

  @IsOptional()
  @IsUUID()
  tripId?: string;

  @IsOptional()
  @IsUUID()
  vehicleId?: string;
}

export class ConfirmOcrDto {
  /** What the human decided the document is booked as. */
  @IsIn(['EXPENSE', 'FUEL'])
  target!: 'EXPENSE' | 'FUEL';

  @IsOptional()
  @IsUUID()
  tripId?: string;

  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @IsUUID()
  driverId?: string;

  /**
   * Human corrections to the AI proposal (same shape as the proposal fields).
   * Stored in ai_requests.corrected_data — the accuracy feedback loop (TZ §8.10).
   */
  @IsOptional()
  @IsObject()
  corrections?: Record<string, unknown>;
}
