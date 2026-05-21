import {useEffect, useState} from 'react';
import {useLocalStorage} from './useLocalStorage';

export type Theme = 'light' | 'dark';

export function useTheme() {
  const [persisted, setPersisted] = useLocalStorage<Theme>('theme', 'light');
  const [theme, setTheme] = useState<Theme>(persisted);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    setPersisted(theme);
  }, [theme, setPersisted]);

  return {theme, setTheme};
}
