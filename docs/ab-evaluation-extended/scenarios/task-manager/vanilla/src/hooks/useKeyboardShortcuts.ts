import {useEffect} from 'react';

export interface UseShortcutsOpts {
  readonly onNew: () => void;
}

export function useKeyboardShortcuts({onNew}: UseShortcutsOpts) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        onNew();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onNew]);
}
