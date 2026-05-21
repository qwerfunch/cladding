import type {Point} from '../lib/types';
import {Sparkline} from './charts/Sparkline';

export interface TrendCardProps {
  readonly label: string;
  readonly data: readonly Point[];
}

export function TrendCard({label, data}: TrendCardProps) {
  const last = data[data.length - 1]?.value ?? 0;
  const first = data[0]?.value ?? 0;
  const direction = last >= first ? '↑' : '↓';
  return (
    <div className="border rounded p-4 bg-white dark:bg-slate-800">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-xl font-semibold">{last.toLocaleString()}</span>
        <span className="text-sm text-slate-500">{direction}</span>
      </div>
      <Sparkline points={data.map((p) => p.value)} />
    </div>
  );
}
