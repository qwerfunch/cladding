import {test, expect} from 'vitest';
import {filterByDateRange} from '../src/lib/filter';
import type {DashboardData} from '../src/lib/types';

const lastUpdated = Date.UTC(2026, 4, 21);
const day = 24 * 60 * 60 * 1000;
const sample: DashboardData = {
  metrics: [],
  revenue: {current: 0, previous: 0},
  sessions: [
    {t: lastUpdated - 100 * day, value: 1},
    {t: lastUpdated - 5 * day, value: 2},
  ],
  health: 'green',
  series: {
    dau: [{t: lastUpdated - 100 * day, value: 1}, {t: lastUpdated - 5 * day, value: 2}],
    retention: [],
  },
  bars: [],
  slices: [],
  topPages: [],
  alerts: [],
  lastUpdated,
};

test('filterByDateRange drops points outside the range', () => {
  const filtered = filterByDateRange(sample, '7d');
  expect(filtered.sessions.length).toBe(1);
  expect(filtered.series.dau.length).toBe(1);
});
