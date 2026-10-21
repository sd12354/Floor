import type { DashboardResponse } from '@/api/types';
import { Card, Badge } from '@/components/ui';
import { formatPct } from '@/lib/money';
import { cn } from '@/lib/cn';

type Health = DashboardResponse['health'];

const riskLabel = { over: 'Over limit', near: 'Near limit', ok: 'OK' } as const;

/** Meter with colour *and* a text state, so risk never relies on colour alone. */
function Meter({ label, value, threshold }: { label: string; value: number; threshold: number }) {
  const ratio = value / threshold;
  const risk = ratio >= 1 ? 'over' : ratio >= 0.6 ? 'near' : 'ok';
  const pct = Math.min(100, ratio * 70); // threshold sits at 70% of the bar so "over" is visible
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-muted">{label}</span>
        <span className="num">
          {formatPct(value)} <span className="text-faint">/ {formatPct(threshold)}</span>
          <span className={cn('ml-1.5 text-[11px] font-sans', risk === 'over' ? 'text-floor' : risk === 'near' ? 'text-amber' : 'text-muted')}>{riskLabel[risk]}</span>
        </span>
      </div>
      <div
        className="relative h-2 mt-1.5 rounded-full bg-sunken overflow-hidden"
        role="meter"
        aria-label={`${label}: ${formatPct(value)} of the ${formatPct(threshold)} eBay limit, ${riskLabel[risk].toLowerCase()}`}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={cn('h-full rounded-full', risk === 'over' ? 'bg-floor' : risk === 'near' ? 'bg-amber' : 'bg-green')} style={{ width: `${pct}%` }} />
        <div className="absolute top-0 bottom-0 w-px bg-ink/50" style={{ left: '70%' }} aria-hidden title="eBay threshold" />
      </div>
    </div>
  );
}

/** eBay seller standing: late shipments and defects against the thresholds that trigger "below standard". */
export function HealthPanel({ health }: { health?: Health }) {
  if (!health) return <Card title="Account health"><div className="h-28 skeleton rounded" /></Card>;
  const atRisk = health.lateShipmentPct >= health.thresholds.lateShipmentPct * 0.6 || health.defectPct >= health.thresholds.defectPct * 0.6 || health.casesOpen > 0;
  return (
    <Card
      title="Account health"
      action={atRisk ? <Badge tone="below">At risk</Badge> : <Badge tone="good">OK</Badge>}
    >
      <div className="flex flex-col gap-3.5">
        <Meter label="Late shipments" value={health.lateShipmentPct} threshold={health.thresholds.lateShipmentPct} />
        <Meter label="Defects" value={health.defectPct} threshold={health.thresholds.defectPct} />
        <div className="flex justify-between text-[13px]">
          <span className="text-muted">Open cases</span>
          <span className={cn('num', health.casesOpen > 0 && 'text-floor font-medium')}>{health.casesOpen}</span>
        </div>
        <p className="text-[12px] text-muted leading-snug">
          The tick marks eBay's limit. Floor cancels before the handling deadline rather than ship late, so these stay low on their own.
        </p>
      </div>
    </Card>
  );
}
