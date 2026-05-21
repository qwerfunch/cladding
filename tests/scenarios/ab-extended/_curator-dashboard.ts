// Cladding · scenarios · ab-extended · curator (dashboard) (v0.3.52, F-ef2fd9)
//
// Emits a complete analytics-dashboard React/Vite/TS/Tailwind project
// for either group. Same shape as the task-manager curator: package
// scaffold + React app + cladding-only governance scaffold for group A.

import {DASHBOARD_FEATURES, type AcceptanceCriterion, type FeatureDef} from './_feature-set-dashboard.js';
import {
  GITIGNORE,
  INDEX_CSS,
  INDEX_HTML,
  MAIN_TSX,
  PACKAGE_JSON_TEMPLATE,
  README_RUN,
  TAILWIND_CONFIG,
  TESTS_SETUP,
  TSCONFIG_JSON,
  VITE_CONFIG,
  write,
} from './_shared-scaffold.js';

const APP_TSX = `import {useState} from 'react';
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
`;

const TYPES_TS = `export type TimeRange = '7d' | '30d' | '90d';
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
`;

const FILTER_TS = `import type {DashboardData, TimeRange} from './types';

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
`;

const EXPORT_CONFIG_TS = `import type {Preferences} from './types';

export function exportPreferences(prefs: Preferences): string {
  return JSON.stringify({schema: 1, prefs}, null, 2);
}
`;

const HEADER = `export function Header() {
  return (
    <header className="text-2xl font-semibold tracking-tight">Analytics Dashboard</header>
  );
}
`;

const FOOTER = `export interface FooterProps {
  readonly lastUpdated: number | null;
}

export function Footer({lastUpdated}: FooterProps) {
  return (
    <footer className="pt-4 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500">
      {lastUpdated ? \`Last updated: \${new Date(lastUpdated).toLocaleString()}\` : 'No data yet'}
    </footer>
  );
}
`;

const SIDEBAR = `export interface SidebarProps {
  readonly section: string;
  readonly onSelect: (s: string) => void;
}

const SECTIONS = ['overview', 'users', 'revenue', 'health'] as const;

export function Sidebar({section, onSelect}: SidebarProps) {
  return (
    <nav className="w-40 shrink-0 border-r border-slate-200 dark:border-slate-700 pr-4">
      <ul className="space-y-1 text-sm">
        {SECTIONS.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => onSelect(s)}
              className={\`block w-full text-left px-2 py-1 rounded \${section === s ? 'bg-slate-200 dark:bg-slate-700' : ''}\`}
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
`;

const BREADCRUMBS = `export interface BreadcrumbsProps {
  readonly section: string;
}

export function Breadcrumbs({section}: BreadcrumbsProps) {
  return (
    <nav className="text-xs text-slate-500" aria-label="breadcrumbs">
      Dashboard / <span className="capitalize">{section}</span>
    </nav>
  );
}
`;

const THEME_TOGGLE = `import type {Theme} from '../hooks/useTheme';

export interface ThemeToggleProps {
  readonly theme: Theme;
  readonly onChange: (t: Theme) => void;
}

export function ThemeToggle({theme, onChange}: ThemeToggleProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(theme === 'dark' ? 'light' : 'dark')}
      className="text-xs uppercase tracking-wider border rounded px-3 py-1"
    >
      {theme === 'dark' ? '☼ light' : '☾ dark'}
    </button>
  );
}
`;

const TIME_RANGE_SELECTOR = `import type {TimeRange} from '../lib/types';

export interface TimeRangeSelectorProps {
  readonly value: TimeRange;
  readonly onChange: (r: TimeRange) => void;
}

const RANGES: readonly TimeRange[] = ['7d', '30d', '90d'];

export function TimeRangeSelector({value, onChange}: TimeRangeSelectorProps) {
  return (
    <div className="flex gap-1 text-sm">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={\`px-3 py-1 border rounded \${value === r ? 'bg-[var(--tm-accent)] text-[var(--tm-accent-text)]' : ''}\`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
`;

const METRIC_CARD = `export interface MetricCardProps {
  readonly label: string;
  readonly value: number;
  readonly delta: number;
}

export function MetricCard({label, value, delta}: MetricCardProps) {
  const positive = delta >= 0;
  return (
    <div className="border rounded p-4 bg-white dark:bg-slate-800">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value.toLocaleString()}</div>
      <div className={positive ? 'text-emerald-600 text-xs' : 'text-rose-600 text-xs'}>
        {positive ? '+' : ''}{(delta * 100).toFixed(1)}%
      </div>
    </div>
  );
}
`;

const CHART_CARD = `import type {ReactNode} from 'react';

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
`;

const LIST_CARD = `export interface ListCardProps {
  readonly title: string;
  readonly items: readonly {readonly path: string; readonly hits: number}[];
}

export function ListCard({title, items}: ListCardProps) {
  return (
    <div className="border rounded p-4 bg-white dark:bg-slate-800">
      <div className="text-sm font-medium mb-2">{title}</div>
      <ul className="text-sm space-y-1">
        {items.map((item) => (
          <li key={item.path} className="flex justify-between">
            <span className="truncate">{item.path}</span>
            <span className="text-slate-500">{item.hits.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
`;

const STATUS_CARD = `import type {HealthStatus} from '../lib/types';

const COLOR: Record<HealthStatus, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
};

export interface StatusCardProps {
  readonly label: string;
  readonly status: HealthStatus;
}

export function StatusCard({label, status}: StatusCardProps) {
  return (
    <div className="border rounded p-4 bg-white dark:bg-slate-800 flex items-center gap-3">
      <span className={\`w-3 h-3 rounded-full \${COLOR[status]}\`} aria-hidden />
      <div>
        <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
        <div className="capitalize">{status}</div>
      </div>
    </div>
  );
}
`;

const ALERT_CARD = `import {useState} from 'react';
import type {AlertItem} from '../lib/types';

const COLOR: Record<AlertItem['severity'], string> = {
  info: 'text-sky-600',
  warn: 'text-amber-600',
  error: 'text-rose-600',
};

export interface AlertCardProps {
  readonly alerts: readonly AlertItem[];
}

export function AlertCard({alerts}: AlertCardProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = alerts.filter((a) => !dismissed.has(a.id));
  return (
    <div className="border rounded p-4 bg-white dark:bg-slate-800">
      <div className="text-sm font-medium mb-2">Alerts</div>
      <ul className="text-sm space-y-1">
        {visible.length === 0 ? (
          <li className="text-slate-500">All clear</li>
        ) : (
          visible.map((a) => (
            <li key={a.id} className={\`flex justify-between gap-2 \${COLOR[a.severity]}\`}>
              <span>{a.message}</span>
              <button
                type="button"
                onClick={() => setDismissed((prev) => new Set(prev).add(a.id))}
                className="text-xs text-slate-400 hover:underline"
              >
                dismiss
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
`;

const COMPARISON_CARD = `export interface ComparisonCardProps {
  readonly label: string;
  readonly current: number;
  readonly previous: number;
}

export function ComparisonCard({label, current, previous}: ComparisonCardProps) {
  const delta = previous === 0 ? 0 : (current - previous) / previous;
  const positive = delta >= 0;
  return (
    <div className="border rounded p-4 bg-white dark:bg-slate-800">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="flex items-baseline justify-between mt-1">
        <span className="text-2xl font-semibold">{current.toLocaleString()}</span>
        <span className="text-xs text-slate-400">prev {previous.toLocaleString()}</span>
      </div>
      <div className={positive ? 'text-emerald-600 text-xs mt-1' : 'text-rose-600 text-xs mt-1'}>
        {positive ? '▲' : '▼'} {(Math.abs(delta) * 100).toFixed(1)}%
      </div>
    </div>
  );
}
`;

const TREND_CARD = `import type {Point} from '../lib/types';
import {Sparkline} from './charts/Sparkline';

export interface TrendCardProps {
  readonly label: string;
  readonly data: readonly Point[];
}

export function TrendCard({label, data}: TrendCardProps) {
  const last = data[data.length - 1]?.value ?? 0;
  const first = data[0]?.value ?? 0;
  const direction = last >= first ? '↑' : '↓';
  return (
    <div className="border rounded p-4 bg-white dark:bg-slate-800">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-xl font-semibold">{last.toLocaleString()}</span>
        <span className="text-sm text-slate-500">{direction}</span>
      </div>
      <Sparkline points={data.map((p) => p.value)} />
    </div>
  );
}
`;

const LINE_CHART = `import type {Point} from '../../lib/types';

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
      return \`\${i === 0 ? 'M' : 'L'}\${x.toFixed(1)},\${y.toFixed(1)}\`;
    })
    .join(' ');
  return (
    <svg viewBox="0 0 100 30" className="w-full h-full" preserveAspectRatio="none">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  );
}
`;

const BAR_CHART = `import type {Bar} from '../../lib/types';

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
`;

const PIE_CHART = `import type {Slice} from '../../lib/types';

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
            d={\`M16,16 L\${x0.toFixed(2)},\${y0.toFixed(2)} A14,14 0 \${large},1 \${x1.toFixed(2)},\${y1.toFixed(2)} Z\`}
            fill={COLORS[i % COLORS.length]}
          />
        );
      })}
    </svg>
  );
}
`;

const AREA_CHART = `import type {Point} from '../../lib/types';

export interface AreaChartProps {
  readonly series: readonly Point[];
}

export function AreaChart({series}: AreaChartProps) {
  if (series.length === 0) return <svg viewBox="0 0 100 30" className="w-full h-full" />;
  const max = Math.max(...series.map((p) => p.value), 1);
  const path = series.map((p, i) => {
    const x = (i / (series.length - 1 || 1)) * 100;
    const y = 30 - (p.value / max) * 28;
    return \`\${i === 0 ? 'M' : 'L'}\${x.toFixed(1)},\${y.toFixed(1)}\`;
  });
  path.push('L100,30 L0,30 Z');
  return (
    <svg viewBox="0 0 100 30" className="w-full h-full" preserveAspectRatio="none">
      <path d={path.join(' ')} fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="0.6" />
    </svg>
  );
}
`;

const SPARKLINE = `export interface SparklineProps {
  readonly points: readonly number[];
}

export function Sparkline({points}: SparklineProps) {
  if (points.length === 0) return <svg viewBox="0 0 100 10" className="w-full h-4" />;
  const max = Math.max(...points, 1);
  const path = points
    .map((v, i) => {
      const x = (i / (points.length - 1 || 1)) * 100;
      const y = 10 - (v / max) * 9;
      return \`\${i === 0 ? 'M' : 'L'}\${x.toFixed(1)},\${y.toFixed(1)}\`;
    })
    .join(' ');
  return (
    <svg viewBox="0 0 100 10" className="w-full h-4" preserveAspectRatio="none">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="0.6" />
    </svg>
  );
}
`;

const CARD_SKELETON = `export function CardSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4">
      {Array.from({length: 4}).map((_, i) => (
        <div key={i} className="border rounded p-4 animate-pulse h-24 bg-slate-100 dark:bg-slate-800" />
      ))}
    </div>
  );
}
`;

const ERROR_STATE = `export interface ErrorStateProps {
  readonly message: string;
  readonly onRetry: () => void;
}

export function ErrorState({message, onRetry}: ErrorStateProps) {
  return (
    <div className="border rounded p-6 bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-200 text-center">
      <p className="font-medium">Failed to load data</p>
      <p className="text-sm mt-1">{message}</p>
      <button type="button" onClick={onRetry} className="mt-3 underline text-sm">
        Retry
      </button>
    </div>
  );
}
`;

const EMPTY_STATE = `export function EmptyState() {
  return (
    <div className="border rounded p-8 text-center text-slate-500">
      <p className="font-medium">No data for the selected range</p>
      <p className="text-sm mt-1">Try a different time range.</p>
    </div>
  );
}
`;

const PREFERENCES_PANEL = `import type {Preferences} from '../lib/types';

export interface PreferencesPanelProps {
  readonly prefs: Preferences;
  readonly onChange: (next: Preferences) => void;
}

export function PreferencesPanel({prefs, onChange}: PreferencesPanelProps) {
  return (
    <details className="border rounded p-3 text-sm">
      <summary className="cursor-pointer select-none">Preferences</summary>
      <div className="mt-2 space-y-2">
        <label className="block">
          Layout
          <select
            value={prefs.layout}
            onChange={(e) => onChange({...prefs, layout: e.target.value as Preferences['layout']})}
            className="ml-2 border rounded px-2 py-1 bg-transparent"
          >
            <option value="grid">Grid</option>
            <option value="list">List</option>
          </select>
        </label>
        <label className="block">
          Density
          <select
            value={prefs.density}
            onChange={(e) => onChange({...prefs, density: e.target.value as Preferences['density']})}
            className="ml-2 border rounded px-2 py-1 bg-transparent"
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </label>
      </div>
    </details>
  );
}
`;

const USE_THEME = `import {useEffect, useState} from 'react';

export type Theme = 'light' | 'dark';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    return (window.localStorage.getItem('theme') as Theme) ?? 'light';
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      window.localStorage.setItem('theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);
  return {theme, setTheme};
}
`;

const USE_PREFERENCES = `import {useEffect, useState} from 'react';
import type {Preferences} from '../lib/types';

const DEFAULT: Preferences = {density: 'comfortable', layout: 'grid'};

export function usePreferences() {
  const [prefs, setPrefs] = useState<Preferences>(() => {
    if (typeof window === 'undefined') return DEFAULT;
    try {
      const raw = window.localStorage.getItem('dashboard-prefs');
      return raw ? (JSON.parse(raw) as Preferences) : DEFAULT;
    } catch {
      return DEFAULT;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('dashboard-prefs', JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [prefs]);
  return {prefs, setPrefs};
}
`;

const USE_REFRESH_INTERVAL = `import {useEffect} from 'react';

export function useRefreshInterval(callback: () => void, intervalMs: number): void {
  useEffect(() => {
    const id = window.setInterval(callback, intervalMs);
    return () => window.clearInterval(id);
  }, [callback, intervalMs]);
}
`;

const USE_DASHBOARD_DATA = `import {useCallback, useEffect, useState} from 'react';
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
`;

const TEST_APP = `import {render, screen} from '@testing-library/react';
import {test, expect} from 'vitest';
import {App} from '../src/App';

test('App renders the Analytics Dashboard header', () => {
  render(<App />);
  expect(screen.getByText(/analytics dashboard/i)).toBeInTheDocument();
});
`;

const TEST_FILTER = `import {test, expect} from 'vitest';
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
`;

const TEST_EXPORT_CONFIG = `import {test, expect} from 'vitest';
import {exportPreferences} from '../src/lib/export-config';

test('exportPreferences emits schema-1 JSON', () => {
  const json = exportPreferences({density: 'compact', layout: 'list'});
  const parsed = JSON.parse(json);
  expect(parsed.schema).toBe(1);
  expect(parsed.prefs.density).toBe('compact');
});
`;

// ──────────────────────────────────────────────────────────────────
// Cladding governance scaffold (dashboard-specific)
// ──────────────────────────────────────────────────────────────────

const CLADDING_SPEC_YAML = `# Cladding · Tier A · SSoT — Iron Law sealed · Refreshed by: clad_create_feature / manual
# dashboard — Cladding spec
# Features live in spec/features/<slug>-<hash>.yaml — one file per feature.

schema: "0.1"

project:
  name: dashboard
  language: typescript
  description: "30-feature React + Vite + TS + Tailwind analytics dashboard — the cladding-managed group of the A/B-extended evaluation scenario 2."
  version: "0.1.0"
  repository: "https://github.com/qwerfunch/cladding"
  intent_summary: "Demonstrate that cladding's governance scaffold scales across domains — same 30-feature framework, different React app, same drift-catch + AI-query benefits."

features: []
`;

const CLADDING_ARCHITECTURE_YAML = `# Cladding · Tier B · SSoT — editable, cross-validated · Refreshed by: clad init / clad refine

layers:
  - - components
    - hooks
  - - lib

forbidden_imports:
  - from: lib
    to: components
  - from: lib
    to: hooks
`;

function renderCladdingCapabilitiesYaml(): string {
  const byCategory = (cat: FeatureDef['category']) =>
    DASHBOARD_FEATURES.filter((f) => f.category === cat).map((f) => f.id).join(', ');
  return `# Cladding · Tier B · SSoT — editable, cross-validated · Refreshed by: clad init / clad refine

schema: "0.1"
source: spec.yaml
capabilities:
  - id: dashboard-layout
    title: "Dashboard layout"
    summary: "App shell, header, footer, sidebar, breadcrumbs, dark mode, responsive layout"
    surface: feature
    features: [${byCategory('layout')}]
  - id: dashboard-cards
    title: "Cards"
    summary: "Metric / chart / list / status / alert / comparison / trend cards + time-range selector"
    surface: feature
    features: [${byCategory('cards')}]
  - id: dashboard-charts
    title: "Charts"
    summary: "Line / bar / pie / area / sparkline SVG charts"
    surface: feature
    features: [${byCategory('charts')}]
  - id: dashboard-data
    title: "Data flow"
    summary: "Mock data source + date-range filter + refresh interval + error/empty states"
    surface: feature
    features: [${byCategory('data')}]
  - id: dashboard-preferences
    title: "Preferences"
    summary: "Theme · layout · density · export configuration"
    surface: feature
    features: [${byCategory('preferences')}]
`;
}

const CLADDING_PROJECT_CONTEXT = `<!-- Cladding · Tier B · SSoT — editable, cross-validated · Refreshed by: clad init / clad refine -->

# dashboard — Project Context

## 1. Why does this project exist?

Scenario 2 of the A/B-extended evaluation framework (F-ef2fd9). Same React + Vite + TS + Tailwind stack as task-manager (scenario 1), different domain — an analytics dashboard with cards, charts, alerts, preferences. The cladding group ships full governance scaffold; the vanilla sibling ships the same React app without spec/.

## 2. What problem does it solve?

Demonstrates that the framework + cladding's value proposition (3/4 drift catch, ≤1-file AI queries, structured artifacts × N features) **generalizes across domains**. If catch rate at task-manager M30 was 3/4, dashboard M30 should hit the same. If AI queries answer ≤1 file at task-manager, dashboard should too.

## 3. What is its purpose?

To produce a second browseable, runnable demonstration that confirms cladding's value isn't tied to any single domain — it's the structural scaffold itself that pays off.
`;

const CLADDING_CONVENTIONS = `<!-- Cladding · Tier C · Derived — observed from code · Refreshed by: clad init --scan -->

# dashboard — Conventions

| Key | Value |
|---|---|
| Indent | two-space |
| Quote | single |
| Semicolon | present |
| Naming | PascalCase for components |
| Test framework | vitest + React Testing Library |
| Charts | inline SVG (no external chart lib) |

Tailwind utility classes; one component per file under \`src/components/\`. Hooks under \`src/hooks/\`. Pure utilities under \`src/lib/\`.
`;

function renderCladdingFeatureShard(f: FeatureDef): string {
  const acLines = f.ac.flatMap((ac: AcceptanceCriterion) => {
    const lines = [`  - id: ${ac.id}`, `    ears: ${ac.ears}`];
    if (ac.condition) lines.push(`    condition: ${ac.condition}`);
    lines.push(`    text: ${JSON.stringify(ac.text)}`);
    lines.push(`    test_refs: [${f.testRef}]`);
    return lines;
  });
  return [
    '# Cladding · Tier A · SSoT — Iron Law sealed · Refreshed by: clad_create_feature / manual',
    `id: ${f.id}`,
    `slug: ${f.slug}`,
    `title: ${JSON.stringify(f.title)}`,
    'status: done',
    `modules: [${f.modules.map((m) => JSON.stringify(m)).join(', ')}]`,
    'acceptance_criteria:',
    ...acLines,
    '',
  ].join('\n');
}

// ──────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────

export function curate(group: 'cladding' | 'vanilla', cwd: string, features: readonly FeatureDef[] = DASHBOARD_FEATURES): void {
  write(cwd, 'package.json', PACKAGE_JSON_TEMPLATE('dashboard'));
  write(cwd, 'tsconfig.json', TSCONFIG_JSON);
  write(cwd, 'vite.config.ts', VITE_CONFIG);
  write(cwd, 'tailwind.config.ts', TAILWIND_CONFIG);
  write(cwd, 'index.html', INDEX_HTML('Analytics Dashboard'));
  write(cwd, 'README.md', README_RUN('dashboard', group));
  write(cwd, '.gitignore', GITIGNORE);

  write(cwd, 'src/main.tsx', MAIN_TSX);
  write(cwd, 'src/index.css', INDEX_CSS);
  write(cwd, 'src/App.tsx', APP_TSX);
  write(cwd, 'src/lib/types.ts', TYPES_TS);
  write(cwd, 'src/lib/filter.ts', FILTER_TS);
  write(cwd, 'src/lib/export-config.ts', EXPORT_CONFIG_TS);

  write(cwd, 'src/components/Header.tsx', HEADER);
  write(cwd, 'src/components/Footer.tsx', FOOTER);
  write(cwd, 'src/components/Sidebar.tsx', SIDEBAR);
  write(cwd, 'src/components/Breadcrumbs.tsx', BREADCRUMBS);
  write(cwd, 'src/components/ThemeToggle.tsx', THEME_TOGGLE);
  write(cwd, 'src/components/TimeRangeSelector.tsx', TIME_RANGE_SELECTOR);
  write(cwd, 'src/components/MetricCard.tsx', METRIC_CARD);
  write(cwd, 'src/components/ChartCard.tsx', CHART_CARD);
  write(cwd, 'src/components/ListCard.tsx', LIST_CARD);
  write(cwd, 'src/components/StatusCard.tsx', STATUS_CARD);
  write(cwd, 'src/components/AlertCard.tsx', ALERT_CARD);
  write(cwd, 'src/components/ComparisonCard.tsx', COMPARISON_CARD);
  write(cwd, 'src/components/TrendCard.tsx', TREND_CARD);
  write(cwd, 'src/components/CardSkeleton.tsx', CARD_SKELETON);
  write(cwd, 'src/components/ErrorState.tsx', ERROR_STATE);
  write(cwd, 'src/components/EmptyState.tsx', EMPTY_STATE);
  write(cwd, 'src/components/PreferencesPanel.tsx', PREFERENCES_PANEL);

  write(cwd, 'src/components/charts/LineChart.tsx', LINE_CHART);
  write(cwd, 'src/components/charts/BarChart.tsx', BAR_CHART);
  write(cwd, 'src/components/charts/PieChart.tsx', PIE_CHART);
  write(cwd, 'src/components/charts/AreaChart.tsx', AREA_CHART);
  write(cwd, 'src/components/charts/Sparkline.tsx', SPARKLINE);

  write(cwd, 'src/hooks/useTheme.ts', USE_THEME);
  write(cwd, 'src/hooks/usePreferences.ts', USE_PREFERENCES);
  write(cwd, 'src/hooks/useRefreshInterval.ts', USE_REFRESH_INTERVAL);
  write(cwd, 'src/hooks/useDashboardData.ts', USE_DASHBOARD_DATA);

  write(cwd, 'tests/_setup.ts', TESTS_SETUP);
  write(cwd, 'tests/app-shell.test.tsx', TEST_APP);
  write(cwd, 'tests/filter.test.ts', TEST_FILTER);
  write(cwd, 'tests/export-config.test.ts', TEST_EXPORT_CONFIG);

  if (group === 'cladding') {
    write(cwd, 'spec.yaml', CLADDING_SPEC_YAML);
    write(cwd, 'spec/architecture.yaml', CLADDING_ARCHITECTURE_YAML);
    write(cwd, 'spec/capabilities.yaml', renderCladdingCapabilitiesYaml());
    write(cwd, 'docs/project-context.md', CLADDING_PROJECT_CONTEXT);
    write(cwd, 'docs/conventions.md', CLADDING_CONVENTIONS);
    for (const f of features) {
      write(cwd, `spec/features/${f.slug}-${f.id.replace('F-', '')}.yaml`, renderCladdingFeatureShard(f));
    }
  }
}
