import {useCallback, useEffect, useState} from 'react';
import type {DashboardData, TimeRange} from '../lib/types';

function deterministicMock(range: TimeRange): DashboardData {
  const now = Date.UTC(2026, 4, 21);
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const dayMs = 24 * 60 * 60 * 1000;
  const sessions = Array.from({length: days}, (_, i) => ({
    t: now - (days - i) * dayMs,
    value: 100 + ((i * 37) % 50),
  }));
  return {
    metrics: [
      {label: 'Active users', value: 14_273, delta: 0.045},
      {label: 'Errors', value: 12, delta: -0.18},
    ],
    revenue: {current: 42_300, previous: 39_100},
    sessions,
    health: 'green',
    series: {dau: sessions, retention: sessions.map((p, i) => ({t: p.t, value: Math.max(0, 100 - i)}))},
    bars: [
      {category: 'web', value: 320},
      {category: 'iOS', value: 210},
      {category: 'Android', value: 180},
      {category: 'API', value: 95},
    ],
    slices: [
      {label: 'organic', value: 45},
      {label: 'referral', value: 28},
      {label: 'paid', value: 18},
      {label: 'direct', value: 9},
    ],
    topPages: [
      {path: '/dashboard', hits: 3104},
      {path: '/pricing', hits: 2410},
      {path: '/docs', hits: 1788},
      {path: '/changelog', hits: 943},
    ],
    alerts: [
      {id: 'a1', severity: 'warn', message: 'p95 latency exceeded 500ms for /api/search'},
      {id: 'a2', severity: 'info', message: 'Scheduled maintenance window 2026-05-25 02:00 UTC'},
    ],
    lastUpdated: now,
  };
}

export function useDashboardData(range: TimeRange) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    try {
      setData(deterministicMock(range));
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {data, loading, error, refresh};
}
