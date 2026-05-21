// Cladding · scenarios · ab-extended · feature set: dashboard (v0.3.52, F-ef2fd9)
//
// 30 analytics-dashboard features grouped into 5 categories:
//   - Layout (8):    app shell, header, footer, sidebar, breadcrumbs, dark mode, responsive, loading
//   - Cards (8):     metric / chart / list / status / alert / comparison / trend / time-range
//   - Charts (5):    line / bar / pie / area / sparkline
//   - Data (5):      mock source, date filter, refresh interval, error states, empty states
//   - Preferences (4): theme · layout · density · export config
//
// Each entry mirrors the task-manager feature-set shape so the curator
// can share the AcceptanceCriterion + FeatureDef structure.

import {createHash} from 'node:crypto';

function fid(slug: string): string {
  const h = createHash('sha256').update(`dashboard:${slug}`).digest('hex').slice(0, 6);
  return `F-${h}`;
}

export interface AcceptanceCriterion {
  readonly id: string;
  readonly ears: 'ubiquitous' | 'event' | 'state' | 'unwanted' | 'optional';
  readonly text: string;
  readonly condition?: string;
}

export interface FeatureDef {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly modules: readonly string[];
  readonly ac: readonly AcceptanceCriterion[];
  readonly testRef: string;
  readonly category: 'layout' | 'cards' | 'charts' | 'data' | 'preferences';
}

function uac(num: number, text: string): AcceptanceCriterion {
  return {id: `AC-${String(num).padStart(3, '0')}`, ears: 'ubiquitous', text};
}

// ──────────────────────────────────────────────────────────────────
// Layout (8)
// ──────────────────────────────────────────────────────────────────

const F01: FeatureDef = {
  id: fid('app-shell'),
  slug: 'app-shell',
  title: 'App shell + root layout',
  modules: ['src/App.tsx', 'src/main.tsx', 'index.html'],
  ac: [uac(1, 'The app shall mount at #root and render the dashboard chrome.')],
  testRef: 'tests/app-shell.test.tsx',
  category: 'layout',
};

const F02: FeatureDef = {
  id: fid('header'),
  slug: 'header',
  title: 'Header with title + user menu',
  modules: ['src/components/Header.tsx'],
  ac: [uac(1, 'The header shall render the dashboard title and a user menu trigger.')],
  testRef: 'tests/header.test.tsx',
  category: 'layout',
};

const F03: FeatureDef = {
  id: fid('footer'),
  slug: 'footer',
  title: 'Footer with last-updated timestamp',
  modules: ['src/components/Footer.tsx'],
  ac: [uac(1, 'The footer shall display the data last-updated time.')],
  testRef: 'tests/footer.test.tsx',
  category: 'layout',
};

const F04: FeatureDef = {
  id: fid('sidebar'),
  slug: 'sidebar',
  title: 'Sidebar navigation',
  modules: ['src/components/Sidebar.tsx'],
  ac: [uac(1, 'The sidebar shall list dashboard sections with active highlight.')],
  testRef: 'tests/sidebar.test.tsx',
  category: 'layout',
};

const F05: FeatureDef = {
  id: fid('breadcrumbs'),
  slug: 'breadcrumbs',
  title: 'Breadcrumbs',
  modules: ['src/components/Breadcrumbs.tsx'],
  ac: [uac(1, 'Breadcrumbs shall reflect the current section path.')],
  testRef: 'tests/breadcrumbs.test.tsx',
  category: 'layout',
};

const F06: FeatureDef = {
  id: fid('dark-mode'),
  slug: 'dark-mode',
  title: 'Dark mode toggle',
  modules: ['src/components/ThemeToggle.tsx', 'src/hooks/useTheme.ts'],
  ac: [uac(1, 'The toggle shall switch the document theme and persist the choice.')],
  testRef: 'tests/theme.test.tsx',
  category: 'layout',
};

const F07: FeatureDef = {
  id: fid('responsive-layout'),
  slug: 'responsive-layout',
  title: 'Responsive layout (mobile + desktop)',
  modules: ['src/index.css'],
  ac: [uac(1, 'The layout shall stack cards vertically on narrow viewports.')],
  testRef: 'tests/responsive.test.ts',
  category: 'layout',
};

const F08: FeatureDef = {
  id: fid('loading-states'),
  slug: 'loading-states',
  title: 'Loading skeletons for cards',
  modules: ['src/components/CardSkeleton.tsx'],
  ac: [uac(1, 'A skeleton shall render while a card is loading data.')],
  testRef: 'tests/loading.test.tsx',
  category: 'layout',
};

// ──────────────────────────────────────────────────────────────────
// Cards (8)
// ──────────────────────────────────────────────────────────────────

const F09: FeatureDef = {
  id: fid('metric-card'),
  slug: 'metric-card',
  title: 'Metric card (KPI display)',
  modules: ['src/components/MetricCard.tsx'],
  ac: [uac(1, 'The metric card shall render label + value + change indicator.')],
  testRef: 'tests/metric-card.test.tsx',
  category: 'cards',
};

const F10: FeatureDef = {
  id: fid('chart-card'),
  slug: 'chart-card',
  title: 'Chart card wrapper',
  modules: ['src/components/ChartCard.tsx'],
  ac: [uac(1, 'The chart card shall provide a titled container for any chart child.')],
  testRef: 'tests/chart-card.test.tsx',
  category: 'cards',
};

const F11: FeatureDef = {
  id: fid('list-card'),
  slug: 'list-card',
  title: 'List card (top-N items)',
  modules: ['src/components/ListCard.tsx'],
  ac: [uac(1, 'The list card shall render a sortable top-N list of items.')],
  testRef: 'tests/list-card.test.tsx',
  category: 'cards',
};

const F12: FeatureDef = {
  id: fid('status-card'),
  slug: 'status-card',
  title: 'Status card (health indicator)',
  modules: ['src/components/StatusCard.tsx'],
  ac: [uac(1, 'The status card shall render a green/amber/red indicator with status label.')],
  testRef: 'tests/status-card.test.tsx',
  category: 'cards',
};

const F13: FeatureDef = {
  id: fid('alert-card'),
  slug: 'alert-card',
  title: 'Alert card (notification surface)',
  modules: ['src/components/AlertCard.tsx'],
  ac: [uac(1, 'The alert card shall render severity + message + dismiss button.')],
  testRef: 'tests/alert-card.test.tsx',
  category: 'cards',
};

const F14: FeatureDef = {
  id: fid('comparison-card'),
  slug: 'comparison-card',
  title: 'Comparison card (this vs previous period)',
  modules: ['src/components/ComparisonCard.tsx'],
  ac: [uac(1, 'The comparison card shall render two values and percentage delta.')],
  testRef: 'tests/comparison-card.test.tsx',
  category: 'cards',
};

const F15: FeatureDef = {
  id: fid('trend-card'),
  slug: 'trend-card',
  title: 'Trend card with sparkline',
  modules: ['src/components/TrendCard.tsx'],
  ac: [uac(1, 'The trend card shall render a label + sparkline + direction arrow.')],
  testRef: 'tests/trend-card.test.tsx',
  category: 'cards',
};

const F16: FeatureDef = {
  id: fid('time-range-selector'),
  slug: 'time-range-selector',
  title: 'Time-range selector (7d / 30d / 90d)',
  modules: ['src/components/TimeRangeSelector.tsx'],
  ac: [uac(1, 'Selecting a range shall update the dashboard data window.')],
  testRef: 'tests/time-range.test.tsx',
  category: 'cards',
};

// ──────────────────────────────────────────────────────────────────
// Charts (5)
// ──────────────────────────────────────────────────────────────────

const F17: FeatureDef = {
  id: fid('line-chart'),
  slug: 'line-chart',
  title: 'Line chart component',
  modules: ['src/components/charts/LineChart.tsx'],
  ac: [uac(1, 'The line chart shall render multi-series time-series data.')],
  testRef: 'tests/line-chart.test.tsx',
  category: 'charts',
};

const F18: FeatureDef = {
  id: fid('bar-chart'),
  slug: 'bar-chart',
  title: 'Bar chart component',
  modules: ['src/components/charts/BarChart.tsx'],
  ac: [uac(1, 'The bar chart shall render categorical bars with axis labels.')],
  testRef: 'tests/bar-chart.test.tsx',
  category: 'charts',
};

const F19: FeatureDef = {
  id: fid('pie-chart'),
  slug: 'pie-chart',
  title: 'Pie chart component',
  modules: ['src/components/charts/PieChart.tsx'],
  ac: [uac(1, 'The pie chart shall render category proportions with legend.')],
  testRef: 'tests/pie-chart.test.tsx',
  category: 'charts',
};

const F20: FeatureDef = {
  id: fid('area-chart'),
  slug: 'area-chart',
  title: 'Area chart component',
  modules: ['src/components/charts/AreaChart.tsx'],
  ac: [uac(1, 'The area chart shall render stacked area series.')],
  testRef: 'tests/area-chart.test.tsx',
  category: 'charts',
};

const F21: FeatureDef = {
  id: fid('sparkline'),
  slug: 'sparkline',
  title: 'Sparkline (inline mini-chart)',
  modules: ['src/components/charts/Sparkline.tsx'],
  ac: [uac(1, 'The sparkline shall render a compact line for inline cards.')],
  testRef: 'tests/sparkline.test.tsx',
  category: 'charts',
};

// ──────────────────────────────────────────────────────────────────
// Data (5)
// ──────────────────────────────────────────────────────────────────

const F22: FeatureDef = {
  id: fid('mock-data-source'),
  slug: 'mock-data-source',
  title: 'Mock data source hook',
  modules: ['src/hooks/useDashboardData.ts', 'src/lib/types.ts'],
  ac: [uac(1, 'The hook shall expose deterministic mock data shaped like the API contract.')],
  testRef: 'tests/data-source.test.ts',
  category: 'data',
};

const F23: FeatureDef = {
  id: fid('date-range-filter'),
  slug: 'date-range-filter',
  title: 'Filter data by date range',
  modules: ['src/lib/filter.ts'],
  ac: [uac(1, 'Data points outside the selected range shall be excluded.')],
  testRef: 'tests/date-filter.test.ts',
  category: 'data',
};

const F24: FeatureDef = {
  id: fid('refresh-interval'),
  slug: 'refresh-interval',
  title: 'Auto-refresh interval (30s default)',
  modules: ['src/hooks/useRefreshInterval.ts'],
  ac: [uac(1, 'The hook shall re-fetch data every interval ms while mounted.')],
  testRef: 'tests/refresh.test.tsx',
  category: 'data',
};

const F25: FeatureDef = {
  id: fid('error-states'),
  slug: 'error-states',
  title: 'Error state rendering for cards',
  modules: ['src/components/ErrorState.tsx'],
  ac: [uac(1, 'A failed card shall render an error message + retry button.')],
  testRef: 'tests/error-state.test.tsx',
  category: 'data',
};

const F26: FeatureDef = {
  id: fid('empty-states'),
  slug: 'empty-states',
  title: 'Empty state placeholder',
  modules: ['src/components/EmptyState.tsx'],
  ac: [uac(1, 'A card with no data shall render an empty-state placeholder.')],
  testRef: 'tests/empty-state.test.tsx',
  category: 'data',
};

// ──────────────────────────────────────────────────────────────────
// Preferences (4)
// ──────────────────────────────────────────────────────────────────

const F27: FeatureDef = {
  id: fid('preferences-panel'),
  slug: 'preferences-panel',
  title: 'Preferences panel',
  modules: ['src/components/PreferencesPanel.tsx', 'src/hooks/usePreferences.ts'],
  ac: [uac(1, 'The panel shall let the user adjust theme, density, and layout.')],
  testRef: 'tests/prefs.test.tsx',
  category: 'preferences',
};

const F28: FeatureDef = {
  id: fid('layout-customization'),
  slug: 'layout-customization',
  title: 'Layout customization (grid vs list)',
  modules: ['src/components/PreferencesPanel.tsx'],
  ac: [uac(1, 'Selecting list layout shall stack cards vertically; grid renders in columns.')],
  testRef: 'tests/layout-pref.test.tsx',
  category: 'preferences',
};

const F29: FeatureDef = {
  id: fid('density-control'),
  slug: 'density-control',
  title: 'Density control (compact / comfortable)',
  modules: ['src/components/PreferencesPanel.tsx'],
  ac: [uac(1, 'Compact density shall reduce card padding by ~50%.')],
  testRef: 'tests/density.test.tsx',
  category: 'preferences',
};

const F30: FeatureDef = {
  id: fid('export-config'),
  slug: 'export-config',
  title: 'Export dashboard configuration as JSON',
  modules: ['src/lib/export-config.ts'],
  ac: [uac(1, 'Clicking Export shall download a JSON of the current preferences + layout.')],
  testRef: 'tests/export-config.test.ts',
  category: 'preferences',
};

export const DASHBOARD_FEATURES: readonly FeatureDef[] = [
  F01, F02, F03, F04, F05, F06, F07, F08,
  F09, F10, F11, F12, F13, F14, F15, F16,
  F17, F18, F19, F20, F21,
  F22, F23, F24, F25, F26,
  F27, F28, F29, F30,
];

export const MILESTONES: readonly number[] = [1, 5, 10, 15, 20, 25, 30];

export function featuresAtMilestone(milestone: number): readonly FeatureDef[] {
  return DASHBOARD_FEATURES.slice(0, milestone);
}
