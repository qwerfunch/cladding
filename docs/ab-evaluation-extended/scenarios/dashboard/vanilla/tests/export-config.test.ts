import {test, expect} from 'vitest';
import {exportPreferences} from '../src/lib/export-config';

test('exportPreferences emits schema-1 JSON', () => {
  const json = exportPreferences({density: 'compact', layout: 'list'});
  const parsed = JSON.parse(json);
  expect(parsed.schema).toBe(1);
  expect(parsed.prefs.density).toBe('compact');
});
