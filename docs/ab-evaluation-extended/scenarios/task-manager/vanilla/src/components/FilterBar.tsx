import type {Category, Filter} from '../lib/types';

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
