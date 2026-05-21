export type TaskStatus = 'open' | 'done';
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
