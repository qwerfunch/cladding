import type {Preferences} from './types';

export function exportPreferences(prefs: Preferences): string {
  return JSON.stringify({schema: 1, prefs}, null, 2);
}
