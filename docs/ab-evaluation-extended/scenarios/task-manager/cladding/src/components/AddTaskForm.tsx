import {useState, type FormEvent} from 'react';

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
