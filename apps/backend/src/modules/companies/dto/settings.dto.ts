import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

/** W-11 settings: alert thresholds (TZ §8.10). AI toggles and limits land in stage 8. */
export class UpdateSettingsDto {
  /** Fuel overrun threshold in basis points — 700 = 7% (TZ default). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  fuelDeviationThresholdBp?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(72)
  idleAlertHours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  routeDeviationKm?: number;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'must be a HH:MM time' })
  digestTime?: string;
}
