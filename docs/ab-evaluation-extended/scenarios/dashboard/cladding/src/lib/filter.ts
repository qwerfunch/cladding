import type {DashboardData, TimeRange} from './types';

const RANGE_MS: Record<TimeRange, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

export function filterByDateRange(data: DashboardData, range: TimeRange): DashboardData {
  const cutoff = data.lastUpdated - RANGE_MS[range];
  return {
    ...data,
    sessions: data.sessions.filter((p) => p.t >= cutoff),
    series: {
      dau: data.series.dau.filter((p) => p.t >= cutoff),
      retention: data.series.retention.filter((p) => p.t >= cutoff),
    },
  };
}
