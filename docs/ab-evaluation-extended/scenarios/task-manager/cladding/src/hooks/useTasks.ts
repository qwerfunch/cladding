import {useEffect, useState, useCallback} from 'react';
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
