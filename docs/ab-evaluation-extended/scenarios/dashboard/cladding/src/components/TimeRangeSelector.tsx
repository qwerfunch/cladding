import type {TimeRange} from '../lib/types';

export interface TimeRangeSelectorProps {
  readonly value: TimeRange;
  readonly onChange: (r: TimeRange) => void;
}

const RANGES: readonly TimeRange[] = ['7d', '30d', '90d'];

export function TimeRangeSelector({value, onChange}: TimeRangeSelectorProps) {
  return (
    <div className="flex gap-1 text-sm">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={`px-3 py-1 border rounded ${value === r ? 'bg-[var(--tm-accent)] text-[var(--tm-accent-text)]' : ''}`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
