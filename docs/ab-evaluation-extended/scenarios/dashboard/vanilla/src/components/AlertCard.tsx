import {useState} from 'react';
import type {AlertItem} from '../lib/types';

const COLOR: Record<AlertItem['severity'], string> = {
  info: 'text-sky-600',
  warn: 'text-amber-600',
  error: 'text-rose-600',
};

export interface AlertCardProps {
  readonly alerts: readonly AlertItem[];
}

export function AlertCard({alerts}: AlertCardProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = alerts.filter((a) => !dismissed.has(a.id));
  return (
    <div className="border rounded p-4 bg-white dark:bg-slate-800">
      <div className="text-sm font-medium mb-2">Alerts</div>
      <ul className="text-sm space-y-1">
        {visible.length === 0 ? (
          <li className="text-slate-500">All clear</li>
        ) : (
          visible.map((a) => (
            <li key={a.id} className={`flex justify-between gap-2 ${COLOR[a.severity]}`}>
              <span>{a.message}</span>
              <button
                type="button"
                onClick={() => setDismissed((prev) => new Set(prev).add(a.id))}
                className="text-xs text-slate-400 hover:underline"
              >
                dismiss
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
