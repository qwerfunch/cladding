import {test, expect} from 'vitest';
import {exportToJson, importFromJson} from '../src/lib/export-import';

test('round-trip export -> import preserves data', () => {
  const tasks = [{id: 'x', title: 't', description: '', status: 'open' as const, priority: 'low' as const, categoryId: null, tags: [], createdAt: 1}];
  const cats = [{id: 'c', name: 'work'}];
  const json = exportToJson(tasks, cats);
  const restored = importFromJson(json);
  expect(restored?.tasks).toEqual(tasks);
  expect(restored?.categories).toEqual(cats);
});

test('importFromJson rejects malformed JSON', () => {
  expect(importFromJson('not json')).toBeNull();
  expect(importFromJson('{"schema": 999}')).toBeNull();
});
