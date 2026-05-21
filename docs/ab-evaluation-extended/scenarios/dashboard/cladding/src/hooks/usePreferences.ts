import {useEffect, useState} from 'react';
import type {Preferences} from '../lib/types';

const DEFAULT: Preferences = {density: 'comfortable', layout: 'grid'};

export function usePreferences() {
  const [prefs, setPrefs] = useState<Preferences>(() => {
    if (typeof window === 'undefined') return DEFAULT;
    try {
      const raw = window.localStorage.getItem('dashboard-prefs');
      return raw ? (JSON.parse(raw) as Preferences) : DEFAULT;
    } catch {
      return DEFAULT;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('dashboard-prefs', JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [prefs]);
  return {prefs, setPrefs};
}
