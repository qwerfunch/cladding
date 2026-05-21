import {useState, useCallback} from 'react';
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
