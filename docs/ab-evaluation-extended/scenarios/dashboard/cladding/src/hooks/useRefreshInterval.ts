import {useEffect} from 'react';

export function useRefreshInterval(callback: () => void, intervalMs: number): void {
  useEffect(() => {
    const id = window.setInterval(callback, intervalMs);
    return () => window.clearInterval(id);
  }, [callback, intervalMs]);
}
