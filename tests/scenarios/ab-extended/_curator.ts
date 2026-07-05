// Cladding · scenarios · ab-extended · curator (v0.3.49, F-0144b9)
//
// Emits a complete task-manager React/Vite/TS/Tailwind project into a
// target directory for either group:
//
//   - **cladding**: full spec scaffold (spec.yaml, 30 spec/features/*.yaml,
//     architecture.yaml, capabilities.yaml, docs/project-context.md,
//     docs/conventions.md) + the React app source.
//   - **vanilla**: same React app source, README, no spec/ no docs/
//     governance.
//
// Both groups share the same React/Vite stack (package.json, vite config,
// tsconfig, tailwind config). The only DELTA between them is the
// governance layer cladding ships. Curator output is byte-deterministic
// across runs (no clocks, no random) so committed outputs double as
// snapshot tests.

import {writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';

import type {AcceptanceCriterion, FeatureDef} from './_feature-set.js';
import {TASK_MANAGER_FEATURES} from './_feature-set.js';

function write(cwd: string, rel: string, body: string): void {
  const abs = join(cwd, rel);
  mkdirSync(dirname(abs), {recursive: true});
  writeFileSync(abs, body);
}

// ──────────────────────────────────────────────────────────────────
// Shared (both groups): React/Vite/TS/Tailwind project scaffold
// ──────────────────────────────────────────────────────────────────

const PACKAGE_JSON = `{
  "name": "task-manager",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.1.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
`;

const TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "useDefineForClassFields": true
  },
  "include": ["src", "tests"]
}
`;

const VITE_CONFIG = `import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/_setup.ts'],
  },
});
`;

const TAILWIND_CONFIG = `import type {Config} from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Task Manager</title>
  </head>
  <body class="bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

const MAIN_TSX = `import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './index.css';
import {App} from './App';

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;

const INDEX_CSS = `@import "tailwindcss";

:root {
  --tm-accent: #2563eb;
  --tm-accent-text: #ffffff;
}

:root.dark {
  --tm-accent: #60a5fa;
}

@media (max-width: 640px) {
  .tm-container {
    padding-inline: 0.75rem;
  }
}
`;

const APP_TSX = `import {useState} from 'react';
import {Header} from './components/Header';
import {Footer} from './components/Footer';
import {TaskList} from './components/TaskList';
import {AddTaskForm} from './components/AddTaskForm';
import {FilterBar} from './components/FilterBar';
import {ThemeToggle} from './components/ThemeToggle';
import {CategoryManager} from './components/CategoryManager';
import {TaskDetailModal} from './components/TaskDetailModal';
import {useTasks} from './hooks/useTasks';
import {useTheme} from './hooks/useTheme';
import {useCategories} from './hooks/useCategories';
import {useKeyboardShortcuts} from './hooks/useKeyboardShortcuts';
import {applyFilter, applySearch, sortByCreated} from './lib/filter';
import {exportToJson, importFromJson} from './lib/export-import';
import type {Filter, Task} from './lib/types';

export function App() {
  const [filter, setFilter] = useState<Filter>({status: 'all'});
  const [search, setSearch] = useState('');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const {tasks, addTask, updateTask, removeTask, toggleDone, clearDone} = useTasks();
  const {categories, addCategory, updateCategory, removeCategory} = useCategories();
  const {theme, setTheme} = useTheme();

  useKeyboardShortcuts({onNew: () => document.getElementById('tm-new-task-input')?.focus()});

  const visible = sortByCreated(applyFilter(applySearch(tasks, search), filter));
  const open = tasks.find((t) => t.id === openTaskId) ?? null;

  return (
    <div className="tm-container max-w-2xl mx-auto p-4 space-y-4">
      <Header />
      <div className="flex items-center justify-between gap-2">
        <ThemeToggle theme={theme} onChange={setTheme} />
        <button
          type="button"
          className="text-sm underline"
          onClick={() => {
            const json = exportToJson(tasks, categories);
            const blob = new Blob([json], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'tasks.json';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export JSON
        </button>
      </div>
      <AddTaskForm onAdd={addTask} />
      <FilterBar
        filter={filter}
        onFilterChange={setFilter}
        search={search}
        onSearchChange={setSearch}
        categories={categories}
      />
      <TaskList
        tasks={visible}
        onToggleDone={toggleDone}
        onRemove={removeTask}
        onOpen={(t: Task) => setOpenTaskId(t.id)}
        onClearDone={clearDone}
        onRename={(id, title) => updateTask(id, {title})}
      />
      <CategoryManager
        categories={categories}
        onAdd={addCategory}
        onUpdate={updateCategory}
        onRemove={removeCategory}
      />
      {open ? (
        <TaskDetailModal
          task={open}
          categories={categories}
          onClose={() => setOpenTaskId(null)}
          onSave={(patch) => {
            updateTask(open.id, patch);
            setOpenTaskId(null);
          }}
        />
      ) : null}
      <Footer
        visibleCount={visible.length}
        onImport={(json) => {
          const result = importFromJson(json);
          if (result) {
            // restored state would replace local arrays; left as a sketch
          }
        }}
      />
    </div>
  );
}
`;

const TYPES_TS = `export type TaskStatus = 'open' | 'done';
export type Priority = 'low' | 'medium' | 'high';

export interface Task {
  readonly id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  categoryId: string | null;
  tags: readonly string[];
  createdAt: number;
}

export interface Category {
  readonly id: string;
  name: string;
}

export interface Filter {
  status: 'all' | 'active' | 'done';
  priority?: Priority;
  categoryId?: string;
  tag?: string;
}
`;

const FILTER_TS = `import type {Filter, Task} from './types';

export function applyFilter(tasks: readonly Task[], f: Filter): readonly Task[] {
  return tasks.filter((t) => {
    if (f.status === 'active' && t.status === 'done') return false;
    if (f.status === 'done' && t.status !== 'done') return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.categoryId && t.categoryId !== f.categoryId) return false;
    if (f.tag && !t.tags.includes(f.tag)) return false;
    return true;
  });
}

export function applySearch(tasks: readonly Task[], query: string): readonly Task[] {
  if (!query.trim()) return tasks;
  const q = query.toLowerCase();
  return tasks.filter((t) => t.title.toLowerCase().includes(q));
}

export function sortByCreated(tasks: readonly Task[]): readonly Task[] {
  return [...tasks].sort((a, b) => b.createdAt - a.createdAt);
}
`;

const EXPORT_IMPORT_TS = `import type {Category, Task} from './types';

export interface ExportShape {
  readonly schema: 1;
  readonly tasks: readonly Task[];
  readonly categories: readonly Category[];
}

export function exportToJson(tasks: readonly Task[], categories: readonly Category[]): string {
  const payload: ExportShape = {schema: 1, tasks, categories};
  return JSON.stringify(payload, null, 2);
}

export function importFromJson(raw: string): ExportShape | null {
  try {
    const parsed = JSON.parse(raw) as ExportShape;
    if (parsed?.schema !== 1) return null;
    if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.categories)) return null;
    return parsed;
  } catch {
    return null;
  }
}
`;

const HEADER_TSX = `export function Header() {
  return (
    <header className="text-2xl font-semibold tracking-tight">
      Task Manager
    </header>
  );
}
`;

const FOOTER_TSX = `export interface FooterProps {
  readonly visibleCount: number;
  readonly onImport: (json: string) => void;
}

export function Footer({visibleCount, onImport}: FooterProps) {
  return (
    <footer className="pt-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500">
      <span>{visibleCount} task(s) visible</span>
      <label className="cursor-pointer underline">
        Import JSON
        <input
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => onImport(String(reader.result ?? ''));
            reader.readAsText(file);
          }}
        />
      </label>
    </footer>
  );
}
`;

const TASK_LIST_TSX = `import type {Task} from '../lib/types';
import {TaskItem} from './TaskItem';

export interface TaskListProps {
  readonly tasks: readonly Task[];
  readonly onToggleDone: (id: string) => void;
  readonly onRemove: (id: string) => void;
  readonly onOpen: (task: Task) => void;
  readonly onClearDone: () => void;
  readonly onRename: (id: string, title: string) => void;
}

export function TaskList(props: TaskListProps) {
  const hasDone = props.tasks.some((t) => t.status === 'done');
  return (
    <section data-testid="task-list" className="space-y-2">
      {props.tasks.length === 0 ? (
        <p className="text-sm text-slate-500">No tasks yet. Add one above.</p>
      ) : null}
      <ul className="divide-y divide-slate-200 dark:divide-slate-700">
        {props.tasks.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            onToggleDone={() => props.onToggleDone(task.id)}
            onRemove={() => props.onRemove(task.id)}
            onOpen={() => props.onOpen(task)}
            onRename={(title) => props.onRename(task.id, title)}
          />
        ))}
      </ul>
      {hasDone ? (
        <button
          type="button"
          onClick={props.onClearDone}
          className="text-xs underline text-slate-500"
        >
          Clear completed
        </button>
      ) : null}
    </section>
  );
}
`;

const TASK_ITEM_TSX = `import {useState} from 'react';
import type {Task} from '../lib/types';

export interface TaskItemProps {
  readonly task: Task;
  readonly onToggleDone: () => void;
  readonly onRemove: () => void;
  readonly onOpen: () => void;
  readonly onRename: (title: string) => void;
}

export function TaskItem({task, onToggleDone, onRemove, onOpen, onRename}: TaskItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);

  return (
    <li className="flex items-center gap-2 py-2">
      <input
        type="checkbox"
        checked={task.status === 'done'}
        onChange={onToggleDone}
        aria-label={\`mark task \${task.id} \${task.status === 'done' ? 'incomplete' : 'complete'}\`}
      />
      {editing ? (
        <input
          type="text"
          className="flex-1 border-b bg-transparent"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft.trim() && draft !== task.title) onRename(draft.trim());
            setEditing(false);
          }}
          autoFocus
        />
      ) : (
        <button
          type="button"
          onDoubleClick={() => setEditing(true)}
          onClick={onOpen}
          className={\`flex-1 text-left \${task.status === 'done' ? 'line-through text-slate-400' : ''}\`}
        >
          {task.title}
          <span className="ml-2 text-xs uppercase tracking-wider text-slate-400">
            {task.priority}
          </span>
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={\`delete task \${task.id}\`}
        className="text-xs text-rose-500 hover:underline"
      >
        ✕
      </button>
    </li>
  );
}
`;

const ADD_TASK_FORM_TSX = `import {useState, type FormEvent} from 'react';

export interface AddTaskFormProps {
  readonly onAdd: (title: string) => void;
}

export function AddTaskForm({onAdd}: AddTaskFormProps) {
  const [title, setTitle] = useState('');

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setTitle('');
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        id="tm-new-task-input"
        type="text"
        placeholder="What needs doing? (press N to focus)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="flex-1 border rounded px-3 py-2 bg-white dark:bg-slate-800"
      />
      <button
        type="submit"
        className="bg-[var(--tm-accent)] text-[var(--tm-accent-text)] rounded px-4"
      >
        Add
      </button>
    </form>
  );
}
`;

const FILTER_BAR_TSX = `import type {Category, Filter} from '../lib/types';

export interface FilterBarProps {
  readonly filter: Filter;
  readonly onFilterChange: (f: Filter) => void;
  readonly search: string;
  readonly onSearchChange: (s: string) => void;
  readonly categories: readonly Category[];
}

export function FilterBar({filter, onFilterChange, search, onSearchChange, categories}: FilterBarProps) {
  return (
    <div className="flex flex-wrap gap-2 items-center text-sm">
      <input
        type="text"
        placeholder="Search…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="border rounded px-2 py-1 bg-white dark:bg-slate-800"
      />
      <select
        value={filter.status}
        onChange={(e) =>
          onFilterChange({...filter, status: e.target.value as Filter['status']})
        }
        className="border rounded px-2 py-1 bg-white dark:bg-slate-800"
      >
        <option value="all">All</option>
        <option value="active">Active</option>
        <option value="done">Done</option>
      </select>
      <select
        value={filter.priority ?? ''}
        onChange={(e) =>
          onFilterChange({
            ...filter,
            priority: e.target.value ? (e.target.value as Filter['priority']) : undefined,
          })
        }
        className="border rounded px-2 py-1 bg-white dark:bg-slate-800"
      >
        <option value="">Any priority</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
      <select
        value={filter.categoryId ?? ''}
        onChange={(e) =>
          onFilterChange({
            ...filter,
            categoryId: e.target.value || undefined,
          })
        }
        className="border rounded px-2 py-1 bg-white dark:bg-slate-800"
      >
        <option value="">Any category</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
`;

const THEME_TOGGLE_TSX = `import type {Theme} from '../hooks/useTheme';

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

const CATEGORY_MANAGER_TSX = `import {useState} from 'react';
import type {Category} from '../lib/types';

export interface CategoryManagerProps {
  readonly categories: readonly Category[];
  readonly onAdd: (name: string) => void;
  readonly onUpdate: (id: string, name: string) => void;
  readonly onRemove: (id: string) => void;
}

export function CategoryManager({categories, onAdd, onUpdate, onRemove}: CategoryManagerProps) {
  const [name, setName] = useState('');

  return (
    <details className="rounded border border-slate-200 dark:border-slate-700 p-3 text-sm">
      <summary className="cursor-pointer select-none">
        Categories ({categories.length})
      </summary>
      <div className="mt-2 space-y-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            onAdd(trimmed);
            setName('');
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            placeholder="New category…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 border rounded px-2 py-1 bg-white dark:bg-slate-800"
          />
          <button type="submit" className="text-xs underline">Add</button>
        </form>
        <ul className="space-y-1">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <input
                type="text"
                value={c.name}
                onChange={(e) => onUpdate(c.id, e.target.value)}
                className="flex-1 border-b bg-transparent"
              />
              <button
                type="button"
                onClick={() => onRemove(c.id)}
                className="text-xs text-rose-500"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
`;

const TASK_DETAIL_MODAL_TSX = `import {useState} from 'react';
import type {Category, Task} from '../lib/types';

export interface TaskDetailModalProps {
  readonly task: Task;
  readonly categories: readonly Category[];
  readonly onClose: () => void;
  readonly onSave: (patch: Partial<Task>) => void;
}

export function TaskDetailModal({task, categories, onClose, onSave}: TaskDetailModalProps) {
  const [description, setDescription] = useState(task.description);
  const [categoryId, setCategoryId] = useState<string | null>(task.categoryId);
  const [tagsText, setTagsText] = useState(task.tags.join(', '));

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4" role="dialog">
      <div className="bg-white dark:bg-slate-800 rounded-lg p-4 max-w-md w-full space-y-3">
        <h3 className="font-semibold">{task.title}</h3>
        <label className="block text-sm">
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full border rounded px-2 py-1 bg-transparent"
            rows={3}
          />
        </label>
        <label className="block text-sm">
          Category
          <select
            value={categoryId ?? ''}
            onChange={(e) => setCategoryId(e.target.value || null)}
            className="mt-1 w-full border rounded px-2 py-1 bg-transparent"
          >
            <option value="">(none)</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Tags (comma-separated)
          <input
            type="text"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            className="mt-1 w-full border rounded px-2 py-1 bg-transparent"
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="text-sm">Cancel</button>
          <button
            type="button"
            onClick={() =>
              onSave({
                description,
                categoryId,
                tags: tagsText
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
              })
            }
            className="text-sm bg-[var(--tm-accent)] text-[var(--tm-accent-text)] rounded px-3 py-1"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
`;

const USE_TASKS_TS = `import {useEffect, useState, useCallback} from 'react';
import type {Task} from '../lib/types';
import {useLocalStorage} from './useLocalStorage';

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function useTasks() {
  const [persisted, setPersisted] = useLocalStorage<Task[]>('tasks', []);
  const [tasks, setTasks] = useState<Task[]>(persisted);

  useEffect(() => setPersisted(tasks), [tasks, setPersisted]);

  const addTask = useCallback((title: string) => {
    setTasks((prev) => [
      ...prev,
      {
        id: newId(),
        title,
        description: '',
        status: 'open',
        priority: 'medium',
        categoryId: null,
        tags: [],
        createdAt: Date.now(),
      },
    ]);
  }, []);

  const updateTask = useCallback((id: string, patch: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? {...t, ...patch} : t)));
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toggleDone = useCallback((id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? {...t, status: t.status === 'done' ? 'open' : 'done'} : t)),
    );
  }, []);

  const clearDone = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status !== 'done'));
  }, []);

  return {tasks, addTask, updateTask, removeTask, toggleDone, clearDone};
}
`;

const USE_THEME_TS = `import {useEffect, useState} from 'react';
import {useLocalStorage} from './useLocalStorage';

export type Theme = 'light' | 'dark';

export function useTheme() {
  const [persisted, setPersisted] = useLocalStorage<Theme>('theme', 'light');
  const [theme, setTheme] = useState<Theme>(persisted);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    setPersisted(theme);
  }, [theme, setPersisted]);

  return {theme, setTheme};
}
`;

const USE_CATEGORIES_TS = `import {useState, useCallback} from 'react';
import type {Category} from '../lib/types';
import {useLocalStorage} from './useLocalStorage';

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function useCategories() {
  const [persisted, setPersisted] = useLocalStorage<Category[]>('categories', []);
  const [categories, setCategories] = useState<Category[]>(persisted);

  const addCategory = useCallback((name: string) => {
    setCategories((prev) => {
      const next = [...prev, {id: newId(), name}];
      setPersisted(next);
      return next;
    });
  }, [setPersisted]);

  const updateCategory = useCallback((id: string, name: string) => {
    setCategories((prev) => {
      const next = prev.map((c) => (c.id === id ? {...c, name} : c));
      setPersisted(next);
      return next;
    });
  }, [setPersisted]);

  const removeCategory = useCallback((id: string) => {
    setCategories((prev) => {
      const next = prev.filter((c) => c.id !== id);
      setPersisted(next);
      return next;
    });
  }, [setPersisted]);

  return {categories, addCategory, updateCategory, removeCategory};
}
`;

const USE_LOCAL_STORAGE_TS = `import {useCallback, useState} from 'react';

export function useLocalStorage<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  const persist = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // ignore quota / private-mode errors
      }
    },
    [key],
  );

  return [value, persist];
}
`;

const USE_KBD_SHORTCUTS_TS = `import {useEffect} from 'react';

export interface UseShortcutsOpts {
  readonly onNew: () => void;
}

export function useKeyboardShortcuts({onNew}: UseShortcutsOpts) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        onNew();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onNew]);
}
`;

// ──────────────────────────────────────────────────────────────────
// Tests (shared)
// ──────────────────────────────────────────────────────────────────

const TESTS_SETUP = `import '@testing-library/jest-dom/vitest';
`;

const TEST_APP_SHELL = `import {render, screen} from '@testing-library/react';
import {test, expect} from 'vitest';
import {App} from '../src/App';

test('App renders the Task Manager header', () => {
  render(<App />);
  expect(screen.getByText(/task manager/i)).toBeInTheDocument();
});
`;

const TEST_ADD_TASK = `import {render, screen, fireEvent} from '@testing-library/react';
import {test, expect} from 'vitest';
import {App} from '../src/App';

test('adding a task makes it visible in the list', () => {
  render(<App />);
  const input = screen.getByPlaceholderText(/what needs doing/i);
  fireEvent.change(input, {target: {value: 'Buy milk'}});
  fireEvent.submit(input.closest('form')!);
  expect(screen.getByText('Buy milk')).toBeInTheDocument();
});
`;

const TEST_FILTER_LIB = `import {test, expect} from 'vitest';
import {applyFilter, applySearch} from '../src/lib/filter';
import type {Task} from '../src/lib/types';

const sample: Task[] = [
  {id: 'a', title: 'apple', description: '', status: 'open', priority: 'low', categoryId: null, tags: ['fruit'], createdAt: 1},
  {id: 'b', title: 'banana', description: '', status: 'done', priority: 'medium', categoryId: null, tags: ['fruit'], createdAt: 2},
];

test('applyFilter filters by status', () => {
  expect(applyFilter(sample, {status: 'active'}).length).toBe(1);
  expect(applyFilter(sample, {status: 'done'}).length).toBe(1);
});

test('applySearch filters by query', () => {
  expect(applySearch(sample, 'ban').length).toBe(1);
  expect(applySearch(sample, '').length).toBe(2);
});
`;

const TEST_EXPORT_IMPORT = `import {test, expect} from 'vitest';
import {exportToJson, importFromJson} from '../src/lib/export-import';

test('round-trip export -> import preserves data', () => {
  const tasks = [{id: 'x', title: 't', description: '', status: 'open' as const, priority: 'low' as const, categoryId: null, tags: [], createdAt: 1}];
  const cats = [{id: 'c', name: 'work'}];
  const json = exportToJson(tasks, cats);
  const restored = importFromJson(json);
  expect(restored?.tasks).toEqual(tasks);
  expect(restored?.categories).toEqual(cats);
});

test('importFromJson rejects malformed JSON', () => {
  expect(importFromJson('not json')).toBeNull();
  expect(importFromJson('{"schema": 999}')).toBeNull();
});
`;

const README_RUN = (group: 'cladding' | 'vanilla') => `# task-manager (${group})

This is the **${group}** group's React + Vite + TS + Tailwind task-manager — auto-generated by
\`tests/scenarios/ab-extended/_curator.ts\` (F-0144b9, v0.3.49) as part of the
large-scale A/B evaluation framework.

${group === 'cladding'
  ? 'Includes the full cladding governance scaffold: `spec.yaml`, `spec/features/*.yaml` × 30, `spec/architecture.yaml`, `spec/capabilities.yaml`, plus `docs/project-context.md` and `docs/conventions.md`.'
  : 'No cladding scaffold — just the React app source. Vanilla developer would ship this on its own.'}

## Run locally

\`\`\`bash
cd "${'$'}{this directory}"
npm install
npm run dev    # opens at http://localhost:5173
\`\`\`

## Test

\`\`\`bash
npm test
\`\`\`

## Compare with the other group

The sibling directory \`../${group === 'cladding' ? 'vanilla' : 'cladding'}/\` ships the same React app
${group === 'cladding' ? 'without' : 'with'} cladding governance. Compare the two trees to see what cladding adds:

- \`spec/\` directory (cladding-only)
- \`docs/project-context.md\`, \`docs/conventions.md\` (cladding-only)
- Tier banners on the first line of every governance file

The 30 features are identical in implementation between the two groups; only
the governance layer differs.

## Source

The full A/B comparison report lives at:
- \`docs/ab-evaluation-extended/scenarios/task-manager/report.md\`
- \`docs/ab-evaluation-extended/README.md\` (methodology)
`;

const GITIGNORE = `node_modules/
dist/
*.log
.env
.DS_Store
`;

// ──────────────────────────────────────────────────────────────────
// Cladding-only artifacts
// ──────────────────────────────────────────────────────────────────

const CLADDING_SPEC_YAML = `# Cladding · Tier A · SSoT — Iron Law sealed · Refreshed by: clad_create_feature / manual
# task-manager — Cladding spec
# Features live in spec/features/<slug>-<hash>.yaml — one file per feature.

schema: "0.1"

project:
  name: task-manager
  language: typescript
  description: "30-feature React + Vite + TS + Tailwind task manager — the cladding-managed group of the A/B-extended evaluation framework."
  version: "0.1.0"
  repository: "https://github.com/qwerfunch/cladding"
  intent_summary: "Demonstrate that cladding's governance scaffold scales with feature count — 30 spec shards, capability bindings, architecture invariants, all queryable from one tree."

features: []
`;

const CLADDING_ARCHITECTURE_YAML = `# Cladding · Tier B · SSoT — editable, cross-validated · Refreshed by: clad init / clad clarify
# Architecture layers (canonical schema). The ARCHITECTURE_FROM_SPEC detector
# enforces forbidden-import rules across these layers.

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

const CLADDING_CAPABILITIES_YAML = `# Cladding · Tier B · SSoT — editable, cross-validated · Refreshed by: clad init / clad clarify
# Capability ↔ feature traceability for task-manager.

schema: "0.1"
source: spec.yaml
capabilities:
  - id: ui-foundation
    title: "UI Foundation"
    summary: "App shell, header, footer, theme system, responsive layout"
    surface: feature
    features: [{{F_APP_SHELL}}, {{F_HEADER}}, {{F_FOOTER}}, {{F_THEME_SYSTEM}}, {{F_DARK_MODE_TOGGLE}}, {{F_KEYBOARD_SHORTCUTS}}, {{F_RESPONSIVE_LAYOUT}}, {{F_LOADING_STATES}}]
  - id: task-crud
    title: "Task CRUD"
    summary: "Create, read, update, delete tasks with inline edit + detail modal + bulk operations"
    surface: feature
    features: [{{F_TASK_LIST}}, {{F_ADD_TASK}}, {{F_MARK_COMPLETE}}, {{F_MARK_INCOMPLETE}}, {{F_DELETE_TASK}}, {{F_EDIT_TASK_TITLE}}, {{F_EDIT_TASK_DESCRIPTION}}, {{F_TASK_DETAIL_MODAL}}, {{F_SORT_BY_CREATED}}, {{F_BULK_DELETE}}]
  - id: filtering
    title: "Filtering & Search"
    summary: "Text search, status/priority/category/tag filters"
    surface: feature
    features: [{{F_TEXT_SEARCH}}, {{F_STATUS_FILTER}}, {{F_PRIORITY_SYSTEM}}, {{F_FILTER_BY_PRIORITY}}, {{F_FILTER_BY_TAG}}]
  - id: categories-tags
    title: "Categories & Tags"
    summary: "Category lifecycle + multi-tag taxonomy"
    surface: feature
    features: [{{F_ADD_CATEGORY}}, {{F_EDIT_CATEGORY}}, {{F_DELETE_CATEGORY}}, {{F_ASSIGN_CATEGORY}}, {{F_TAG_SYSTEM}}]
  - id: persistence
    title: "Persistence"
    summary: "localStorage + JSON export/import"
    surface: feature
    features: [{{F_LOCALSTORAGE}}, {{F_JSON_EXPORT}}]
`;

const CLADDING_PROJECT_CONTEXT = `<!-- Cladding · Tier B · SSoT — editable, cross-validated · Refreshed by: clad init / clad clarify -->

# task-manager — Project Context

## 1. Why does this project exist?

This is the **cladding** group of the large-scale A/B evaluation framework (F-0144b9). A 30-feature task-manager React app, fully scaffolded by cladding's SSoT governance. The sibling \`vanilla/\` directory ships the same React app without governance — comparing the two lets reviewers see exactly what cladding adds at scale.

## 2. What problem does it solve?

Demonstrates, at scale (30 features instead of the 1-feature M2 in the earlier F-4db939/F-ba2e05 A/B tests), that cladding's structural artifacts (spec shards, capabilities, architecture rules) compose into a queryable knowledge graph an AI agent can navigate. Vanilla provides no such surface; cladding's value is proportional to feature count.

## 3. What is its purpose?

To produce a **browseable, runnable** demonstration of cladding-at-scale that a user can \`cd\` into and explore. Each of the 30 features is implemented in shared React components but documented in its own \`spec/features/<slug>-<hash>.yaml\` shard with explicit ACs and module paths.
`;

const CLADDING_CONVENTIONS = `<!-- Cladding · Tier C · Derived — observed from code · Refreshed by: clad init --scan -->

# task-manager — Conventions

| Key | Value |
|---|---|
| Indent | two-space |
| Quote | single |
| Semicolon | present |
| Naming (exports) | camelCase / PascalCase for components |
| File extensions (imports) | none (Vite handles \`.tsx\` resolution) |
| Test framework | vitest + React Testing Library |
| State | React hooks; no external state library |

Tailwind utility classes are used in JSX. Each component lives in a single file; hooks live in \`src/hooks/\`; pure utilities in \`src/lib/\`.
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

function findFeature(slug: string): FeatureDef {
  const f = TASK_MANAGER_FEATURES.find((feat) => feat.slug === slug);
  if (!f) throw new Error(`feature with slug "${slug}" not found`);
  return f;
}

function resolveCapabilitiesBindings(template: string): string {
  return template
    .replace('{{F_APP_SHELL}}', findFeature('app-shell').id)
    .replace('{{F_HEADER}}', findFeature('header').id)
    .replace('{{F_FOOTER}}', findFeature('footer').id)
    .replace('{{F_THEME_SYSTEM}}', findFeature('theme-system').id)
    .replace('{{F_DARK_MODE_TOGGLE}}', findFeature('dark-mode-toggle').id)
    .replace('{{F_KEYBOARD_SHORTCUTS}}', findFeature('keyboard-shortcuts').id)
    .replace('{{F_RESPONSIVE_LAYOUT}}', findFeature('responsive-layout').id)
    .replace('{{F_LOADING_STATES}}', findFeature('loading-states').id)
    .replace('{{F_TASK_LIST}}', findFeature('task-list').id)
    .replace('{{F_ADD_TASK}}', findFeature('add-task').id)
    .replace('{{F_MARK_COMPLETE}}', findFeature('mark-complete').id)
    .replace('{{F_MARK_INCOMPLETE}}', findFeature('mark-incomplete').id)
    .replace('{{F_DELETE_TASK}}', findFeature('delete-task').id)
    .replace('{{F_EDIT_TASK_TITLE}}', findFeature('edit-task-title').id)
    .replace('{{F_EDIT_TASK_DESCRIPTION}}', findFeature('edit-task-description').id)
    .replace('{{F_TASK_DETAIL_MODAL}}', findFeature('task-detail-modal').id)
    .replace('{{F_SORT_BY_CREATED}}', findFeature('sort-by-created').id)
    .replace('{{F_BULK_DELETE}}', findFeature('bulk-delete').id)
    .replace('{{F_TEXT_SEARCH}}', findFeature('text-search').id)
    .replace('{{F_STATUS_FILTER}}', findFeature('status-filter').id)
    .replace('{{F_PRIORITY_SYSTEM}}', findFeature('priority-system').id)
    .replace('{{F_FILTER_BY_PRIORITY}}', findFeature('filter-by-priority').id)
    .replace('{{F_FILTER_BY_TAG}}', findFeature('filter-by-tag').id)
    .replace('{{F_ADD_CATEGORY}}', findFeature('add-category').id)
    .replace('{{F_EDIT_CATEGORY}}', findFeature('edit-category').id)
    .replace('{{F_DELETE_CATEGORY}}', findFeature('delete-category').id)
    .replace('{{F_ASSIGN_CATEGORY}}', findFeature('assign-category').id)
    .replace('{{F_TAG_SYSTEM}}', findFeature('tag-system').id)
    .replace('{{F_LOCALSTORAGE}}', findFeature('localstorage').id)
    .replace('{{F_JSON_EXPORT}}', findFeature('json-export').id);
}

// ──────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────

/** Writes the complete React task-manager project for the given group at the given cwd. */
export function curate(group: 'cladding' | 'vanilla', cwd: string, features: readonly FeatureDef[] = TASK_MANAGER_FEATURES): void {
  // ── Shared project scaffold ───────────────────────────────
  write(cwd, 'package.json', PACKAGE_JSON);
  write(cwd, 'tsconfig.json', TSCONFIG_JSON);
  write(cwd, 'vite.config.ts', VITE_CONFIG);
  write(cwd, 'tailwind.config.ts', TAILWIND_CONFIG);
  write(cwd, 'index.html', INDEX_HTML);
  write(cwd, 'README.md', README_RUN(group));
  write(cwd, '.gitignore', GITIGNORE);

  // ── React app ────────────────────────────────────────────
  write(cwd, 'src/main.tsx', MAIN_TSX);
  write(cwd, 'src/index.css', INDEX_CSS);
  write(cwd, 'src/App.tsx', APP_TSX);
  write(cwd, 'src/lib/types.ts', TYPES_TS);
  write(cwd, 'src/lib/filter.ts', FILTER_TS);
  write(cwd, 'src/lib/export-import.ts', EXPORT_IMPORT_TS);
  write(cwd, 'src/components/Header.tsx', HEADER_TSX);
  write(cwd, 'src/components/Footer.tsx', FOOTER_TSX);
  write(cwd, 'src/components/TaskList.tsx', TASK_LIST_TSX);
  write(cwd, 'src/components/TaskItem.tsx', TASK_ITEM_TSX);
  write(cwd, 'src/components/AddTaskForm.tsx', ADD_TASK_FORM_TSX);
  write(cwd, 'src/components/FilterBar.tsx', FILTER_BAR_TSX);
  write(cwd, 'src/components/ThemeToggle.tsx', THEME_TOGGLE_TSX);
  write(cwd, 'src/components/CategoryManager.tsx', CATEGORY_MANAGER_TSX);
  write(cwd, 'src/components/TaskDetailModal.tsx', TASK_DETAIL_MODAL_TSX);
  write(cwd, 'src/hooks/useTasks.ts', USE_TASKS_TS);
  write(cwd, 'src/hooks/useTheme.ts', USE_THEME_TS);
  write(cwd, 'src/hooks/useCategories.ts', USE_CATEGORIES_TS);
  write(cwd, 'src/hooks/useLocalStorage.ts', USE_LOCAL_STORAGE_TS);
  write(cwd, 'src/hooks/useKeyboardShortcuts.ts', USE_KBD_SHORTCUTS_TS);

  // ── Tests (subset, representative) ───────────────────────
  write(cwd, 'tests/_setup.ts', TESTS_SETUP);
  write(cwd, 'tests/app-shell.test.tsx', TEST_APP_SHELL);
  write(cwd, 'tests/add-task.test.tsx', TEST_ADD_TASK);
  write(cwd, 'tests/filter.test.ts', TEST_FILTER_LIB);
  write(cwd, 'tests/export-import.test.ts', TEST_EXPORT_IMPORT);

  // ── Cladding-only governance ─────────────────────────────
  if (group === 'cladding') {
    write(cwd, 'spec.yaml', CLADDING_SPEC_YAML);
    write(cwd, 'spec/architecture.yaml', CLADDING_ARCHITECTURE_YAML);
    write(cwd, 'spec/capabilities.yaml', resolveCapabilitiesBindings(CLADDING_CAPABILITIES_YAML));
    write(cwd, 'docs/project-context.md', CLADDING_PROJECT_CONTEXT);
    write(cwd, 'docs/conventions.md', CLADDING_CONVENTIONS);
    for (const f of features) {
      write(cwd, `spec/features/${f.slug}-${f.id.replace('F-', '')}.yaml`, renderCladdingFeatureShard(f));
    }
    emitTaskManagerScenarios(cwd);
  }
}

// ──────────────────────────────────────────────────────────────────
// Scenario shards (F-f334fa, v0.3.55)
// User journeys binding multiple features. Q5 of the AI-query
// benchmark answers via `readdirSync(spec/scenarios)` = 1 op.
// ──────────────────────────────────────────────────────────────────

interface ScenarioShard {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly flow: string;
  readonly featureSlugs: readonly string[];
}

function renderScenarioShard(s: ScenarioShard): string {
  const featureIds = s.featureSlugs
    .map((slug) => TASK_MANAGER_FEATURES.find((f) => f.slug === slug)?.id ?? '')
    .filter((id) => id);
  return [
    '# Cladding · Tier A · SSoT — Iron Law sealed · Refreshed by: clad_create_feature / manual',
    `id: ${s.id}`,
    `slug: ${s.slug}`,
    `title: ${JSON.stringify(s.title)}`,
    'flow: |',
    ...s.flow.split('\n').map((line) => `  ${line}`),
    `features: [${featureIds.join(', ')}]`,
    '',
  ].join('\n');
}

const TM_SCENARIOS_README = `<!-- Cladding · Tier A · SSoT — Iron Law sealed · Refreshed by: clad_create_feature / manual -->

# task-manager · scenarios

User journeys binding multiple features into end-to-end flows. Auto-emitted by \`_curator.ts\` (F-f334fa, v0.3.55) so the AI-query Q5 (\"How many test scenarios are declared?\") answers in 1 directory read.
`;

function emitTaskManagerScenarios(cwd: string): void {
  write(cwd, 'spec/scenarios/first-time-onboarding-3525f0.yaml', renderScenarioShard({
    id: 'S-3525f0',
    slug: 'first-time-onboarding',
    title: 'First-time user adds and completes their first task',
    flow:
      'A new user opens the app, types "Buy milk" into the AddTaskForm, presses Add, sees the task appear in the TaskList, then clicks the checkbox to mark it done. The task moves to the done state and Clear-completed becomes available.',
    featureSlugs: ['app-shell', 'add-task', 'task-list', 'mark-complete'],
  }));
  write(cwd, 'spec/scenarios/power-user-bulk-b53dd9.yaml', renderScenarioShard({
    id: 'S-b53dd9',
    slug: 'power-user-bulk',
    title: 'Power user filters and bulk-clears completed work',
    flow:
      'A user with dozens of tasks opens the FilterBar, narrows by status=done + priority=high, then presses Clear completed to remove all matching items in one operation. The task list reflects the filter immediately.',
    featureSlugs: ['status-filter', 'filter-by-priority', 'bulk-delete'],
  }));
  write(cwd, 'spec/scenarios/data-portability-560c61.yaml', renderScenarioShard({
    id: 'S-560c61',
    slug: 'data-portability',
    title: 'User exports tasks as JSON and re-imports on another device',
    flow:
      'User clicks Export JSON, saves the file, opens the same app on another device, picks Import JSON, and sees their tasks + categories restored. Round-trip is loss-less.',
    featureSlugs: ['json-export', 'localstorage'],
  }));
  write(cwd, 'spec/scenarios/README.md', TM_SCENARIOS_README);
}
