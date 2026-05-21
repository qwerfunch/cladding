import {useState} from 'react';
import {Header} from './components/Header';
import {Footer} from './components/Footer';
import {Sidebar} from './components/Sidebar';
import {Breadcrumbs} from './components/Breadcrumbs';
import {ThemeToggle} from './components/ThemeToggle';
import {TimeRangeSelector} from './components/TimeRangeSelector';
import {MetricCard} from './components/MetricCard';
import {ChartCard} from './components/ChartCard';
import {ListCard} from './components/ListCard';
import {StatusCard} from './components/StatusCard';
import {AlertCard} from './components/AlertCard';
import {ComparisonCard} from './components/ComparisonCard';
import {TrendCard} from './components/TrendCard';
import {LineChart} from './components/charts/LineChart';
import {BarChart} from './components/charts/BarChart';
import {PieChart} from './components/charts/PieChart';
import {AreaChart} from './components/charts/AreaChart';
import {Sparkline} from './components/charts/Sparkline';
import {CardSkeleton} from './components/CardSkeleton';
import {ErrorState} from './components/ErrorState';
import {EmptyState} from './components/EmptyState';
import {PreferencesPanel} from './components/PreferencesPanel';
import {useTheme} from './hooks/useTheme';
import {useDashboardData} from './hooks/useDashboardData';
import {usePreferences} from './hooks/usePreferences';
import {useRefreshInterval} from './hooks/useRefreshInterval';
import {filterByDateRange} from './lib/filter';
import {exportPreferences} from './lib/export-config';
import type {TimeRange} from './lib/types';

export function App() {
  const {theme, setTheme} = useTheme();
  const {prefs, setPrefs} = usePreferences();
  const [range, setRange] = useState<TimeRange>('30d');
  const [section, setSection] = useState<string>('overview');
  const {data, loading, error, refresh} = useDashboardData(range);

  useRefreshInterval(refresh, 30_000);

  const visible = data ? filterByDateRange(data, range) : null;

  return (
    <div className="tm-container max-w-6xl mx-auto p-4 space-y-4 flex">
      <Sidebar section={section} onSelect={setSection} />
      <div className="flex-1 space-y-4 pl-4">
        <Header />
        <Breadcrumbs section={section} />
        <div className="flex items-center justify-between gap-2">
          <TimeRangeSelector value={range} onChange={setRange} />
          <div className="flex gap-2">
            <ThemeToggle theme={theme} onChange={setTheme} />
            <button
              type="button"
              onClick={() => {
                const json = exportPreferences(prefs);
                const blob = new Blob([json], {type: 'application/json'});
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'dashboard-prefs.json';
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="text-sm underline"
            >
              Export config
            </button>
          </div>
        </div>
        {error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : loading ? (
          <CardSkeleton />
        ) : visible && visible.metrics.length > 0 ? (
          <div className={prefs.layout === 'grid' ? 'grid grid-cols-2 gap-4' : 'space-y-4'}>
            <MetricCard label="Active users" value={visible.metrics[0]?.value ?? 0} delta={visible.metrics[0]?.delta ?? 0} />
            <ComparisonCard label="Revenue" current={visible.revenue.current} previous={visible.revenue.previous} />
            <TrendCard label="Sessions" data={visible.sessions} />
            <StatusCard label="API health" status={visible.health} />
            <ChartCard title="Daily active users">
              <LineChart series={visible.series.dau} />
            </ChartCard>
            <ChartCard title="Conversion by channel">
              <BarChart bars={visible.bars} />
            </ChartCard>
            <ChartCard title="Traffic mix">
              <PieChart slices={visible.slices} />
            </ChartCard>
            <ChartCard title="Cohort retention">
              <AreaChart series={visible.series.retention} />
            </ChartCard>
            <ListCard title="Top pages" items={visible.topPages} />
            <AlertCard alerts={visible.alerts} />
            <ChartCard title="Latency p95">
              <Sparkline points={visible.sessions.map((s) => s.value)} />
            </ChartCard>
          </div>
        ) : (
          <EmptyState />
        )}
        <PreferencesPanel prefs={prefs} onChange={setPrefs} />
        <Footer lastUpdated={data?.lastUpdated ?? null} />
      </div>
    </div>
  );
}
