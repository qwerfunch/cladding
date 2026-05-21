import type {Category, Task} from './types';

export interface ExportShape {
  readonly schema: 1;
  readonly tasks: readonly Task[];
  readonly categories: readonly Category[];
}

export function exportToJson(tasks: readonly Task[], categories: readonly Category[]): string {
  const payload: ExportShape = {schema: 1, tasks, categories};
  return JSON.stringify(payload, null, 2);
}

export function importFromJson(raw: string): ExportShape | null {
  try {
    const parsed = JSON.parse(raw) as ExportShape;
    if (parsed?.schema !== 1) return null;
    if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.categories)) return null;
    return parsed;
  } catch {
    return null;
  }
}
