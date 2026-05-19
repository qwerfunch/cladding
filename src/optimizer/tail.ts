// Cladding · Token Optimizer · Tail-only Logging
//
// Per ironclad-design/04-token-efficiency.md §Tail-only Logging: when
// a test fails, the model rarely needs the whole stdout — just the
// last N lines around the failure plus a small head for context.
// This trims log payloads from kilobytes to dozens of lines.

/**
 * Returns up to `headLines` from the start and `tailLines` from the
 * end of `text`, joined by an elision marker when the middle was cut.
 */
export function headTail(
  text: string,
  headLines: number = 5,
  tailLines: number = 30,
): string {
  const lines = text.split('\n');
  if (lines.length <= headLines + tailLines) return text;
  const head = lines.slice(0, headLines);
  const tail = lines.slice(-tailLines);
  const middleCount = lines.length - headLines - tailLines;
  return [...head, `… [${middleCount} line(s) elided]`, ...tail].join('\n');
}
