import {useState} from 'react';
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
