import type {ReactNode} from 'react';

export interface ChartCardProps {
  readonly title: string;
  readonly children: ReactNode;
}

export function ChartCard({title, children}: ChartCardProps) {
  return (
    <div className="border rounded p-4 bg-white dark:bg-slate-800">
      <div className="text-sm font-medium mb-2">{title}</div>
      <div className="h-32">{children}</div>
    </div>
  );
}
