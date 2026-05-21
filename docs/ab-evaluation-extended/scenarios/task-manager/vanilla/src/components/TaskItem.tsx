import {useState} from 'react';
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
        aria-label={`mark task ${task.id} ${task.status === 'done' ? 'incomplete' : 'complete'}`}
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
          className={`flex-1 text-left ${task.status === 'done' ? 'line-through text-slate-400' : ''}`}
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
        aria-label={`delete task ${task.id}`}
        className="text-xs text-rose-500 hover:underline"
      >
        ✕
      </button>
    </li>
  );
}
