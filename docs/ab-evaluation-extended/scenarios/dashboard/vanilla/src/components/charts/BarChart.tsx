import type {Bar} from '../../lib/types';

export interface BarChartProps {
  readonly bars: readonly Bar[];
}

export function BarChart({bars}: BarChartProps) {
  if (bars.length === 0) return <svg viewBox="0 0 100 30" className="w-full h-full" />;
  const max = Math.max(...bars.map((b) => b.value), 1);
  const barWidth = 90 / bars.length;
  return (
    <svg viewBox="0 0 100 30" className="w-full h-full" preserveAspectRatio="none">
      {bars.map((b, i) => {
        const h = (b.value / max) * 28;
        return (
          <rect
            key={b.category}
            x={5 + i * barWidth}
            y={30 - h}
            width={barWidth * 0.8}
            height={h}
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}
