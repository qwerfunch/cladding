import type {Task} from '../lib/types';
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
