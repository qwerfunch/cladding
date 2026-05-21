export type TimeRange = '7d' | '30d' | '90d';
export type HealthStatus = 'green' | 'amber' | 'red';

export interface Metric {
  readonly label: string;
  readonly value: number;
  readonly delta: number;
}

export interface Point {
  readonly t: number;  // epoch ms
  readonly value: number;
}

export interface Bar {
  readonly category: string;
  readonly value: number;
}

export interface Slice {
  readonly label: string;
  readonly value: number;
}

export interface AlertItem {
  readonly id: string;
  readonly severity: 'info' | 'warn' | 'error';
  readonly message: string;
}

export interface DashboardData {
  readonly metrics: readonly Metric[];
  readonly revenue: {readonly current: number; readonly previous: number};
  readonly sessions: readonly Point[];
  readonly health: HealthStatus;
  readonly series: {readonly dau: readonly Point[]; readonly retention: readonly Point[]};
  readonly bars: readonly Bar[];
  readonly slices: readonly Slice[];
  readonly topPages: readonly {readonly path: string; readonly hits: number}[];
  readonly alerts: readonly AlertItem[];
  readonly lastUpdated: number;
}

export interface Preferences {
  readonly density: 'compact' | 'comfortable';
  readonly layout: 'grid' | 'list';
}
