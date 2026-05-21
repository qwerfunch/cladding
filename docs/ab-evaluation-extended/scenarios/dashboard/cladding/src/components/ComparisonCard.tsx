export interface ComparisonCardProps {
  readonly label: string;
  readonly current: number;
  readonly previous: number;
}

export function ComparisonCard({label, current, previous}: ComparisonCardProps) {
  const delta = previous === 0 ? 0 : (current - previous) / previous;
  const positive = delta >= 0;
  return (
    <div className="border rounded p-4 bg-white dark:bg-slate-800">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="flex items-baseline justify-between mt-1">
        <span className="text-2xl font-semibold">{current.toLocaleString()}</span>
        <span className="text-xs text-slate-400">prev {previous.toLocaleString()}</span>
      </div>
      <div className={positive ? 'text-emerald-600 text-xs mt-1' : 'text-rose-600 text-xs mt-1'}>
        {positive ? '▲' : '▼'} {(Math.abs(delta) * 100).toFixed(1)}%
      </div>
    </div>
  );
}
