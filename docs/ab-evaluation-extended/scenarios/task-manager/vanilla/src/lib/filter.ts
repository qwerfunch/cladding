import type {Filter, Task} from './types';

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
