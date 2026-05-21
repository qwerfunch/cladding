export interface SparklineProps {
  readonly points: readonly number[];
}

export function Sparkline({points}: SparklineProps) {
  if (points.length === 0) return <svg viewBox="0 0 100 10" className="w-full h-4" />;
  const max = Math.max(...points, 1);
  const path = points
    .map((v, i) => {
      const x = (i / (points.length - 1 || 1)) * 100;
      const y = 10 - (v / max) * 9;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox="0 0 100 10" className="w-full h-4" preserveAspectRatio="none">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="0.6" />
    </svg>
  );
}
