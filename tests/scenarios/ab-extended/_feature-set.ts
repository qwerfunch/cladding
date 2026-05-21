// Cladding · scenarios · ab-extended · feature set (v0.3.49, F-0144b9)
//
// 30 task-manager features grouped by category:
//   - UI/Foundation (8):    F01-F08 — app shell, header, footer, theme, dark mode, shortcuts, layout, loading
//   - Task CRUD (10):       F09-F18 — list, add, edit-title, edit-desc, delete, mark-complete, mark-incomplete, detail, sort, bulk
//   - Filtering/Search (5): F19-F23 — text search, status, priority, filter-by-priority, filter-by-tag
//   - Categories/Tags (5):  F24-F28 — add-category, edit-category, delete-category, assign-category, tag-system
//   - Persistence (2):      F29-F30 — localStorage, JSON import/export
//
// Each feature carries id (deterministic F-<hash6> derived from slug),
// modules touched, ACs with `test_refs`, and a target component name.
// The curator (_curator.ts) consumes this list and emits matching
// React/Vite/TS source for both groups at each milestone.

import {createHash} from 'node:crypto';

/** Derives a stable 6-char hex id from a slug. Keeps F-<hash6> convention without runtime randomness. */
function fid(slug: string): string {
  const h = createHash('sha256').update(`task-manager:${slug}`).digest('hex').slice(0, 6);
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
  /** File paths this feature touches (used by spec shard + drift). */
  readonly modules: readonly string[];
  readonly ac: readonly AcceptanceCriterion[];
  /** One test file per feature. */
  readonly testRef: string;
  /** Category for the milestone grouping. */
  readonly category: 'ui' | 'crud' | 'filter' | 'category' | 'persistence';
}

function uac(num: number, text: string): AcceptanceCriterion {
  return {id: `AC-${String(num).padStart(3, '0')}`, ears: 'ubiquitous', text};
}
function unw(num: number, condition: string, text: string): AcceptanceCriterion {
  return {id: `AC-${String(num).padStart(3, '0')}`, ears: 'unwanted', condition, text};
}

// ──────────────────────────────────────────────────────────────────
// UI / Foundation (8 features, M01..M05+overflow)
// ──────────────────────────────────────────────────────────────────

export const F01_APP_SHELL: FeatureDef = {
  id: fid('app-shell'),
  slug: 'app-shell',
  title: 'App shell + root layout',
  modules: ['src/App.tsx', 'src/main.tsx', 'index.html'],
  ac: [uac(1, 'The app shall render an App component mounted at #root in index.html.')],
  testRef: 'tests/app-shell.test.tsx',
  category: 'ui',
};

export const F02_HEADER: FeatureDef = {
  id: fid('header'),
  slug: 'header',
  title: 'Header with app title',
  modules: ['src/components/Header.tsx'],
  ac: [uac(1, 'The header shall render the application title prominently.')],
  testRef: 'tests/header.test.tsx',
  category: 'ui',
};

export const F03_FOOTER: FeatureDef = {
  id: fid('footer'),
  slug: 'footer',
  title: 'Footer with task count summary',
  modules: ['src/components/Footer.tsx'],
  ac: [uac(1, 'The footer shall display the current visible task count.')],
  testRef: 'tests/footer.test.tsx',
  category: 'ui',
};

export const F04_THEME_SYSTEM: FeatureDef = {
  id: fid('theme-system'),
  slug: 'theme-system',
  title: 'Theme system (light/dark CSS variables)',
  modules: ['src/lib/theme.ts', 'src/index.css'],
  ac: [uac(1, 'The system shall expose a light theme and a dark theme via CSS variables.')],
  testRef: 'tests/theme.test.ts',
  category: 'ui',
};

export const F05_DARK_MODE_TOGGLE: FeatureDef = {
  id: fid('dark-mode-toggle'),
  slug: 'dark-mode-toggle',
  title: 'Dark mode toggle button',
  modules: ['src/components/ThemeToggle.tsx', 'src/hooks/useTheme.ts'],
  ac: [
    uac(1, 'The toggle shall switch the document theme between light and dark.'),
    uac(2, 'The toggle shall persist the user choice across reloads via localStorage.'),
  ],
  testRef: 'tests/theme-toggle.test.tsx',
  category: 'ui',
};

export const F06_KEYBOARD_SHORTCUTS: FeatureDef = {
  id: fid('keyboard-shortcuts'),
  slug: 'keyboard-shortcuts',
  title: 'Keyboard shortcuts (N = new task, / = focus search)',
  modules: ['src/hooks/useKeyboardShortcuts.ts'],
  ac: [uac(1, 'Pressing "n" shall focus the new-task input.')],
  testRef: 'tests/shortcuts.test.tsx',
  category: 'ui',
};

export const F07_RESPONSIVE_LAYOUT: FeatureDef = {
  id: fid('responsive-layout'),
  slug: 'responsive-layout',
  title: 'Responsive layout (mobile + desktop)',
  modules: ['src/index.css'],
  ac: [uac(1, 'The layout shall reflow gracefully on viewports narrower than 640px.')],
  testRef: 'tests/responsive.test.ts',
  category: 'ui',
};

export const F08_LOADING_STATES: FeatureDef = {
  id: fid('loading-states'),
  slug: 'loading-states',
  title: 'Loading spinner component',
  modules: ['src/components/LoadingSpinner.tsx'],
  ac: [uac(1, 'The spinner shall render a visually identifiable indicator.')],
  testRef: 'tests/loading.test.tsx',
  category: 'ui',
};

// ──────────────────────────────────────────────────────────────────
// Task CRUD (10 features, M05..M10)
// ──────────────────────────────────────────────────────────────────

export const F09_TASK_LIST: FeatureDef = {
  id: fid('task-list'),
  slug: 'task-list',
  title: 'Render task list from state',
  modules: ['src/components/TaskList.tsx', 'src/components/TaskItem.tsx', 'src/lib/types.ts'],
  ac: [uac(1, 'The TaskList component shall render one TaskItem per task in state.')],
  testRef: 'tests/task-list.test.tsx',
  category: 'crud',
};

export const F10_ADD_TASK: FeatureDef = {
  id: fid('add-task'),
  slug: 'add-task',
  title: 'Add task via input form',
  modules: ['src/components/AddTaskForm.tsx', 'src/hooks/useTasks.ts'],
  ac: [
    uac(1, 'Submitting the new-task form shall append a task to state.'),
    unw(2, 'if the title input is empty', 'the system shall not append the task.'),
  ],
  testRef: 'tests/add-task.test.tsx',
  category: 'crud',
};

export const F11_MARK_COMPLETE: FeatureDef = {
  id: fid('mark-complete'),
  slug: 'mark-complete',
  title: 'Mark task complete via checkbox',
  modules: ['src/components/TaskItem.tsx'],
  ac: [uac(1, 'Checking the checkbox shall flip the task status to "done".')],
  testRef: 'tests/mark-complete.test.tsx',
  category: 'crud',
};

export const F12_MARK_INCOMPLETE: FeatureDef = {
  id: fid('mark-incomplete'),
  slug: 'mark-incomplete',
  title: 'Mark task incomplete via checkbox',
  modules: ['src/components/TaskItem.tsx'],
  ac: [uac(1, 'Unchecking the checkbox shall flip the task status back to "open".')],
  testRef: 'tests/mark-incomplete.test.tsx',
  category: 'crud',
};

export const F13_DELETE_TASK: FeatureDef = {
  id: fid('delete-task'),
  slug: 'delete-task',
  title: 'Delete task via per-row trash button',
  modules: ['src/components/TaskItem.tsx', 'src/hooks/useTasks.ts'],
  ac: [uac(1, 'Clicking the trash button shall remove the task from state.')],
  testRef: 'tests/delete-task.test.tsx',
  category: 'crud',
};

export const F14_EDIT_TASK_TITLE: FeatureDef = {
  id: fid('edit-task-title'),
  slug: 'edit-task-title',
  title: 'Edit task title in place',
  modules: ['src/components/TaskItem.tsx'],
  ac: [uac(1, 'Double-clicking the title shall open an inline editor; blur shall save.')],
  testRef: 'tests/edit-title.test.tsx',
  category: 'crud',
};

export const F15_EDIT_TASK_DESCRIPTION: FeatureDef = {
  id: fid('edit-task-description'),
  slug: 'edit-task-description',
  title: 'Edit task description in detail modal',
  modules: ['src/components/TaskDetailModal.tsx'],
  ac: [uac(1, 'The detail modal shall let the user edit the task description and save it.')],
  testRef: 'tests/edit-description.test.tsx',
  category: 'crud',
};

export const F16_TASK_DETAIL_MODAL: FeatureDef = {
  id: fid('task-detail-modal'),
  slug: 'task-detail-modal',
  title: 'Task detail modal (open on row click)',
  modules: ['src/components/TaskDetailModal.tsx', 'src/components/TaskList.tsx'],
  ac: [uac(1, 'Clicking a task row shall open the detail modal with all task fields.')],
  testRef: 'tests/task-detail.test.tsx',
  category: 'crud',
};

export const F17_SORT_BY_CREATED: FeatureDef = {
  id: fid('sort-by-created'),
  slug: 'sort-by-created',
  title: 'Sort tasks by created date',
  modules: ['src/lib/sort.ts', 'src/components/TaskList.tsx'],
  ac: [uac(1, 'Selecting the "created" sort option shall reorder tasks by creation timestamp.')],
  testRef: 'tests/sort.test.ts',
  category: 'crud',
};

export const F18_BULK_DELETE: FeatureDef = {
  id: fid('bulk-delete'),
  slug: 'bulk-delete',
  title: 'Bulk delete completed tasks',
  modules: ['src/components/TaskList.tsx'],
  ac: [uac(1, 'Pressing "Clear completed" shall remove every task with status "done".')],
  testRef: 'tests/bulk-delete.test.tsx',
  category: 'crud',
};

// ──────────────────────────────────────────────────────────────────
// Filtering & Search (5 features, M11..M15)
// ──────────────────────────────────────────────────────────────────

export const F19_TEXT_SEARCH: FeatureDef = {
  id: fid('text-search'),
  slug: 'text-search',
  title: 'Text search across task titles',
  modules: ['src/components/SearchInput.tsx', 'src/lib/filter.ts'],
  ac: [uac(1, 'Typing in the search input shall filter visible tasks to those whose title contains the query.')],
  testRef: 'tests/search.test.tsx',
  category: 'filter',
};

export const F20_STATUS_FILTER: FeatureDef = {
  id: fid('status-filter'),
  slug: 'status-filter',
  title: 'Filter tasks by status (all / active / done)',
  modules: ['src/components/FilterBar.tsx', 'src/lib/filter.ts'],
  ac: [uac(1, 'Selecting "active" shall hide tasks with status "done".')],
  testRef: 'tests/status-filter.test.tsx',
  category: 'filter',
};

export const F21_PRIORITY_SYSTEM: FeatureDef = {
  id: fid('priority-system'),
  slug: 'priority-system',
  title: 'Priority field (low / medium / high)',
  modules: ['src/lib/types.ts', 'src/components/TaskItem.tsx'],
  ac: [uac(1, 'Each task shall carry a priority field with one of low / medium / high.')],
  testRef: 'tests/priority.test.ts',
  category: 'filter',
};

export const F22_FILTER_BY_PRIORITY: FeatureDef = {
  id: fid('filter-by-priority'),
  slug: 'filter-by-priority',
  title: 'Filter tasks by priority',
  modules: ['src/components/FilterBar.tsx', 'src/lib/filter.ts'],
  ac: [uac(1, 'Selecting "high priority" shall narrow visible tasks to those with priority high.')],
  testRef: 'tests/priority-filter.test.tsx',
  category: 'filter',
};

export const F23_FILTER_BY_TAG: FeatureDef = {
  id: fid('filter-by-tag'),
  slug: 'filter-by-tag',
  title: 'Filter tasks by tag',
  modules: ['src/components/FilterBar.tsx', 'src/lib/filter.ts'],
  ac: [uac(1, 'Selecting a tag chip shall narrow visible tasks to those carrying the tag.')],
  testRef: 'tests/tag-filter.test.tsx',
  category: 'filter',
};

// ──────────────────────────────────────────────────────────────────
// Categories & Tags (5 features, M16..M25)
// ──────────────────────────────────────────────────────────────────

export const F24_ADD_CATEGORY: FeatureDef = {
  id: fid('add-category'),
  slug: 'add-category',
  title: 'Add new category',
  modules: ['src/components/CategoryManager.tsx', 'src/hooks/useCategories.ts', 'src/lib/types.ts'],
  ac: [uac(1, 'Submitting the new-category input shall append a category to state.')],
  testRef: 'tests/add-category.test.tsx',
  category: 'category',
};

export const F25_EDIT_CATEGORY: FeatureDef = {
  id: fid('edit-category'),
  slug: 'edit-category',
  title: 'Edit category name',
  modules: ['src/components/CategoryManager.tsx'],
  ac: [uac(1, 'The user shall be able to edit an existing category name in place.')],
  testRef: 'tests/edit-category.test.tsx',
  category: 'category',
};

export const F26_DELETE_CATEGORY: FeatureDef = {
  id: fid('delete-category'),
  slug: 'delete-category',
  title: 'Delete category',
  modules: ['src/components/CategoryManager.tsx', 'src/hooks/useCategories.ts'],
  ac: [uac(1, 'Deleting a category shall remove it from state and clear it from any task that referenced it.')],
  testRef: 'tests/delete-category.test.tsx',
  category: 'category',
};

export const F27_ASSIGN_CATEGORY: FeatureDef = {
  id: fid('assign-category'),
  slug: 'assign-category',
  title: 'Assign category to task',
  modules: ['src/components/TaskDetailModal.tsx'],
  ac: [uac(1, 'The task detail modal shall let the user assign exactly one category to the task.')],
  testRef: 'tests/assign-category.test.tsx',
  category: 'category',
};

export const F28_TAG_SYSTEM: FeatureDef = {
  id: fid('tag-system'),
  slug: 'tag-system',
  title: 'Tag system (multi-tag per task)',
  modules: ['src/components/TagInput.tsx', 'src/lib/types.ts'],
  ac: [uac(1, 'The user shall be able to attach multiple tags to a single task.')],
  testRef: 'tests/tags.test.tsx',
  category: 'category',
};

// ──────────────────────────────────────────────────────────────────
// Persistence (2 features, M29..M30)
// ──────────────────────────────────────────────────────────────────

export const F29_LOCALSTORAGE: FeatureDef = {
  id: fid('localstorage'),
  slug: 'localstorage',
  title: 'Persist tasks + categories to localStorage',
  modules: ['src/hooks/useLocalStorage.ts', 'src/hooks/useTasks.ts'],
  ac: [
    uac(1, 'On state change, tasks shall be serialized to localStorage under the key "tasks".'),
    uac(2, 'On app boot, tasks shall be rehydrated from localStorage if present.'),
  ],
  testRef: 'tests/localstorage.test.ts',
  category: 'persistence',
};

export const F30_JSON_EXPORT: FeatureDef = {
  id: fid('json-export'),
  slug: 'json-export',
  title: 'Export tasks as JSON file',
  modules: ['src/lib/export-import.ts', 'src/components/Footer.tsx'],
  ac: [
    uac(1, 'Clicking "Export" shall download a JSON file containing all tasks + categories.'),
    uac(2, 'Pasting a previously-exported JSON into the import field shall restore the state.'),
  ],
  testRef: 'tests/export-import.test.ts',
  category: 'persistence',
};

/** All 30 features in milestone order. */
export const TASK_MANAGER_FEATURES: readonly FeatureDef[] = [
  F01_APP_SHELL,
  F02_HEADER,
  F03_FOOTER,
  F04_THEME_SYSTEM,
  F05_DARK_MODE_TOGGLE,
  F06_KEYBOARD_SHORTCUTS,
  F07_RESPONSIVE_LAYOUT,
  F08_LOADING_STATES,
  F09_TASK_LIST,
  F10_ADD_TASK,
  F11_MARK_COMPLETE,
  F12_MARK_INCOMPLETE,
  F13_DELETE_TASK,
  F14_EDIT_TASK_TITLE,
  F15_EDIT_TASK_DESCRIPTION,
  F16_TASK_DETAIL_MODAL,
  F17_SORT_BY_CREATED,
  F18_BULK_DELETE,
  F19_TEXT_SEARCH,
  F20_STATUS_FILTER,
  F21_PRIORITY_SYSTEM,
  F22_FILTER_BY_PRIORITY,
  F23_FILTER_BY_TAG,
  F24_ADD_CATEGORY,
  F25_EDIT_CATEGORY,
  F26_DELETE_CATEGORY,
  F27_ASSIGN_CATEGORY,
  F28_TAG_SYSTEM,
  F29_LOCALSTORAGE,
  F30_JSON_EXPORT,
];

/** Milestones at which snapshots are taken (1-indexed feature counts). */
export const MILESTONES: readonly number[] = [1, 5, 10, 15, 20, 25, 30];

/** Returns the subset of features done at the given milestone. */
export function featuresAtMilestone(milestone: number): readonly FeatureDef[] {
  return TASK_MANAGER_FEATURES.slice(0, milestone);
}
