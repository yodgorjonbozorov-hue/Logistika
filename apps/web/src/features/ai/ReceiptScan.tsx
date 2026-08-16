import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiStatus, useScanDocument, type OcrCheck, type OcrProposal } from '../../shared/api/ai';
import { Badge, Button, ErrorMessage, Spinner } from '../../shared/ui';
import { formatDate } from '../../shared/utils/date';
import { formatDecimal } from '../../shared/utils/format';
import { formatTiyin } from '../../shared/utils/money';

/** Centilitres on the wire → litres for the eye, without leaving integers. */
export function centilitresToLitres(value: string | null): string {
  if (!value) return '—';
  const centilitres = BigInt(value);
  const sign = centilitres < 0n ? '-' : '';
  const abs = centilitres < 0n ? -centilitres : centilitres;
  return formatDecimal(`${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`, 2);
}

function CheckRow({ check }: { check: OcrCheck }) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <Badge tone={check.severity === 'ERROR' ? 'red' : 'orange'}>
        {t(`ai.check.${check.code}.label`)}
      </Badge>
      <span className="text-muted">{t(`ai.check.${check.code}.message`, check.params)}</span>
    </li>
  );
}

/**
 * AI-2 confirmation window (TZ §8.3): photo → reading → the user decides.
 *
 * The proposal is only ever handed to `onApply`, which fills the form the user
 * was already going to submit. Nothing here saves anything — the record is
 * created by the ordinary form, after a person has looked at these numbers.
 */
export function ReceiptScan({
  context,
  onApply,
}: {
  context?: { tripId?: string; vehicleId?: string };
  onApply: (proposal: OcrProposal) => void;
}) {
  const { t } = useTranslation();
  const { data: status } = useAiStatus();
  const scan = useScanDocument();
  const [proposal, setProposal] = useState<OcrProposal | null>(null);
  const input = useRef<HTMLInputElement>(null);

  if (!status?.available) return null;

  async function onPick(file: File | undefined) {
    if (!file) return;
    setProposal(null);
    // Geolocation is a nicety: without it the GPS check simply reports nothing.
    const at = await currentPosition();
    setProposal(await scan.mutateAsync({ file, ...context, ...at }));
  }

  function apply() {
    if (!proposal) return;
    onApply(proposal);
    setProposal(null);
  }

  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-3 dark:border-white/15">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{t('ai.scan.title')}</p>
          <p className="text-xs text-muted">{t('ai.scan.hint')}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={scan.isPending}
          onClick={() => input.current?.click()}
        >
          {scan.isPending ? t('ai.scan.reading') : t('ai.scan.action')}
        </Button>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          void onPick(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      {scan.isPending && <Spinner />}
      <ErrorMessage error={scan.error} />

      {proposal && (
        <div className="mt-3 space-y-2 border-t border-gray-200 pt-3 dark:border-white/10">
          <p className="text-sm font-semibold">
            {t(`ai.docType.${proposal.fields.docType}`)}
            {proposal.confidenceBp !== null && (
              <span className="ml-2 text-xs font-normal text-muted">
                {t('ai.scan.confidence', { percent: (proposal.confidenceBp / 100).toFixed(0) })}
              </span>
            )}
          </p>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            <Read label={t('fuel.station')} value={proposal.fields.vendor} />
            <Read
              label={t('fuel.date')}
              value={proposal.fields.date ? formatDate(proposal.fields.date) : null}
            />
            <Read label={t('fuel.litres')} value={centilitresToLitres(proposal.fields.litersCl)} />
            <Read
              label={t('fuel.pricePerLitre')}
              value={
                proposal.fields.pricePerLiter ? formatTiyin(proposal.fields.pricePerLiter) : null
              }
            />
            <Read
              label={t('fuel.amount')}
              value={proposal.fields.totalAmount ? formatTiyin(proposal.fields.totalAmount) : null}
            />
            <Read label={t('fuel.odometer')} value={proposal.fields.odometer?.toString() ?? null} />
          </dl>

          {proposal.checks.length > 0 && (
            <ul className="space-y-1">
              {proposal.checks.map((check) => (
                <CheckRow key={check.code} check={check} />
              ))}
            </ul>
          )}

          <p className="text-xs text-muted">{t('ai.scan.disclaimer')}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setProposal(null)}>
              {t('ai.scan.discard')}
            </Button>
            <Button type="button" onClick={apply}>
              {t('ai.scan.apply')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Read({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tabular-nums">{value && value !== '—' ? value : '—'}</dd>
    </div>
  );
}

/** Best-effort position; a refusal or a missing sensor is not an error here. */
async function currentPosition(): Promise<{ lat?: number; lng?: number }> {
  if (!navigator.geolocation) return {};
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve({}),
      { timeout: 5000, maximumAge: 60_000 },
    );
  });
}
