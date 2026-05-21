import type {HealthStatus} from '../lib/types';

const COLOR: Record<HealthStatus, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
};

export interface StatusCardProps {
  readonly label: string;
  readonly status: HealthStatus;
}

export function StatusCard({label, status}: StatusCardProps) {
  return (
    <div className="border rounded p-4 bg-white dark:bg-slate-800 flex items-center gap-3">
      <span className={`w-3 h-3 rounded-full ${COLOR[status]}`} aria-hidden />
      <div>
        <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
        <div className="capitalize">{status}</div>
      </div>
    </div>
  );
}
