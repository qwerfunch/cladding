import {useState} from 'react';
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
