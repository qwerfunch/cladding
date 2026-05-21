export interface MetricCardProps {
  readonly label: string;
  readonly value: number;
  readonly delta: number;
}

export function MetricCard({label, value, delta}: MetricCardProps) {
  const positive = delta >= 0;
  return (
    <div className="border rounded p-4 bg-white dark:bg-slate-800">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value.toLocaleString()}</div>
      <div className={positive ? 'text-emerald-600 text-xs' : 'text-rose-600 text-xs'}>
        {positive ? '+' : ''}{(delta * 100).toFixed(1)}%
      </div>
    </div>
  );
}
