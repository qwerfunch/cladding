import {test, expect} from 'vitest';
import {applyFilter, applySearch} from '../src/lib/filter';
import type {Task} from '../src/lib/types';

const sample: Task[] = [
  {id: 'a', title: 'apple', description: '', status: 'open', priority: 'low', categoryId: null, tags: ['fruit'], createdAt: 1},
  {id: 'b', title: 'banana', description: '', status: 'done', priority: 'medium', categoryId: null, tags: ['fruit'], createdAt: 2},
];

test('applyFilter filters by status', () => {
  expect(applyFilter(sample, {status: 'active'}).length).toBe(1);
  expect(applyFilter(sample, {status: 'done'}).length).toBe(1);
});

test('applySearch filters by query', () => {
  expect(applySearch(sample, 'ban').length).toBe(1);
  expect(applySearch(sample, '').length).toBe(2);
});
