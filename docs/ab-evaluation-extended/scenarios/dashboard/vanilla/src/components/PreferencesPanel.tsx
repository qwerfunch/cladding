import type {Preferences} from '../lib/types';

export interface PreferencesPanelProps {
  readonly prefs: Preferences;
  readonly onChange: (next: Preferences) => void;
}

export function PreferencesPanel({prefs, onChange}: PreferencesPanelProps) {
  return (
    <details className="border rounded p-3 text-sm">
      <summary className="cursor-pointer select-none">Preferences</summary>
      <div className="mt-2 space-y-2">
        <label className="block">
          Layout
          <select
            value={prefs.layout}
            onChange={(e) => onChange({...prefs, layout: e.target.value as Preferences['layout']})}
            className="ml-2 border rounded px-2 py-1 bg-transparent"
          >
            <option value="grid">Grid</option>
            <option value="list">List</option>
          </select>
        </label>
        <label className="block">
          Density
          <select
            value={prefs.density}
            onChange={(e) => onChange({...prefs, density: e.target.value as Preferences['density']})}
            className="ml-2 border rounded px-2 py-1 bg-transparent"
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </label>
      </div>
    </details>
  );
}
