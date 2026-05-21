import type {Point} from '../../lib/types';

export interface LineChartProps {
  readonly series: readonly Point[];
}

export function LineChart({series}: LineChartProps) {
  if (series.length === 0) return <svg viewBox="0 0 100 30" className="w-full h-full" />;
  const max = Math.max(...series.map((p) => p.value), 1);
  const path = series
    .map((p, i) => {
      const x = (i / (series.length - 1 || 1)) * 100;
      const y = 30 - (p.value / max) * 28;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox="0 0 100 30" className="w-full h-full" preserveAspectRatio="none">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  );
}
