import type {Slice} from '../../lib/types';

export interface PieChartProps {
  readonly slices: readonly Slice[];
}

const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export function PieChart({slices}: PieChartProps) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <svg viewBox="0 0 32 32" className="w-full h-full" />;
  let angle = 0;
  return (
    <svg viewBox="0 0 32 32" className="w-full h-full">
      {slices.map((s, i) => {
        const portion = s.value / total;
        const a0 = angle;
        const a1 = angle + portion * Math.PI * 2;
        const x0 = 16 + 14 * Math.cos(a0 - Math.PI / 2);
        const y0 = 16 + 14 * Math.sin(a0 - Math.PI / 2);
        const x1 = 16 + 14 * Math.cos(a1 - Math.PI / 2);
        const y1 = 16 + 14 * Math.sin(a1 - Math.PI / 2);
        const large = portion > 0.5 ? 1 : 0;
        angle = a1;
        return (
          <path
            key={s.label}
            d={`M16,16 L${x0.toFixed(2)},${y0.toFixed(2)} A14,14 0 ${large},1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`}
            fill={COLORS[i % COLORS.length]}
          />
        );
      })}
    </svg>
  );
}
