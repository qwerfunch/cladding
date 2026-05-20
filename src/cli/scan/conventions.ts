// Cladding · scan · 14 deterministic convention detectors
//
// Each detector consumes the full SourceFile[] and emits one
// {@link Conventions} field. Majority-rule heuristics, no AST, no
// LLM — runtime stays single-bundle friendly.
//
// Languages covered (v0.3.26 polyglot expansion):
//   - JS/TS/Java/Kotlin/C++/C#/Scala/Dart — classic `/** */`
//   - Python — triple-quoted strings + Google-style sections
//   - Go — leading `//` block above func + `Deprecated:` sentinel
//   - Rust — `///` docs + `# Errors` / `# Safety` sentinels
//   - Swift — `///` doc comments
//   - Ruby — leading `#` block above def

import {sep} from 'node:path';

import {isJsLike} from './helpers.js';
import type {Conventions, SourceFile} from './types.js';

/** Aggregates 14 convention signals across the file set. */
export function extractConventions(files: readonly SourceFile[]): Conventions {
  return {
    indent: detectIndent(files),
    quote: detectQuote(files),
    semicolon: detectSemicolon(files),
    namingExports: detectNamingExports(files),
    namingConstants: detectNamingConstants(files),
    docBlockRatio: detectDocBlockRatio(files),
    docTagCounts: detectDocTagCounts(files),
    importOrder: detectImportOrder(files),
    exportPattern: detectExportPattern(files),
    errorHandling: detectErrorHandling(files),
    typeDefLocation: detectTypeDefLocation(files),
    fileHeaderPattern: detectFileHeaderPattern(files),
    testLocation: detectTestLocation(files),
    moduleBoilerplate: detectModuleBoilerplate(files),
  };
}

function detectIndent(files: readonly SourceFile[]): Conventions['indent'] {
  let two = 0;
  let four = 0;
  let tab = 0;
  for (const f of files) {
    for (const line of f.content.split('\n')) {
      if (line.startsWith('\t')) tab++;
      else if (line.startsWith('    ') && !line.startsWith('     ')) four++;
      else if (line.startsWith('  ') && !line.startsWith('   ')) two++;
    }
  }
  const max = Math.max(two, four, tab);
  if (max === 0) return 'mixed';
  if (max === two && two > four * 2 && two > tab * 2) return 'two-space';
  if (max === four && four > two * 2 && four > tab * 2) return 'four-space';
  if (max === tab && tab > two * 2 && tab > four * 2) return 'tab';
  return 'mixed';
}

function detectQuote(files: readonly SourceFile[]): Conventions['quote'] {
  let single = 0;
  let double = 0;
  for (const f of files) {
    single += (f.content.match(/'/g) ?? []).length;
    double += (f.content.match(/"/g) ?? []).length;
  }
  if (single > double * 2) return 'single';
  if (double > single * 2) return 'double';
  return 'mixed';
}

function detectSemicolon(files: readonly SourceFile[]): Conventions['semicolon'] {
  let withSemi = 0;
  let withoutSemi = 0;
  for (const f of files) {
    if (!isJsLike(f.relPath)) continue;
    for (const line of f.content.split('\n')) {
      const t = line.trim();
      if (t.length === 0 || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
      if (t.endsWith(';')) withSemi++;
      else if (t.endsWith(')') || t.endsWith('}') || t.endsWith(',')) withoutSemi++;
    }
  }
  if (withSemi > withoutSemi * 3) return 'present';
  if (withoutSemi > withSemi * 3) return 'absent';
  return 'mixed';
}

function detectNamingExports(files: readonly SourceFile[]): Conventions['namingExports'] {
  let camel = 0;
  let snake = 0;
  let pascal = 0;
  for (const f of files) {
    for (const m of f.content.matchAll(/^\s*export\s+(?:const|function|let|var|class)\s+(\w+)/gm)) {
      const name = m[1];
      if (/^[A-Z]/.test(name)) pascal++;
      else if (name.includes('_')) snake++;
      else camel++;
    }
  }
  const max = Math.max(camel, snake, pascal);
  if (max === 0) return 'mixed';
  if (max === camel && camel > snake * 2 && camel > pascal * 2) return 'camelCase';
  if (max === snake && snake > camel * 2 && snake > pascal * 2) return 'snake_case';
  if (max === pascal && pascal > camel * 2 && pascal > snake * 2) return 'PascalCase';
  return 'mixed';
}

function detectNamingConstants(files: readonly SourceFile[]): Conventions['namingConstants'] {
  let upper = 0;
  let camel = 0;
  for (const f of files) {
    for (const m of f.content.matchAll(/^\s*(?:export\s+)?const\s+(\w+)\s*[:=]/gm)) {
      const name = m[1];
      if (/^[A-Z][A-Z0-9_]+$/.test(name)) upper++;
      else if (/^[a-z]/.test(name)) camel++;
    }
  }
  if (upper > camel * 0.3) return 'UPPER_SNAKE';
  if (camel > upper * 3) return 'camelCase';
  return 'mixed';
}

function detectDocBlockRatio(files: readonly SourceFile[]): number {
  let funcs = 0;
  let docBlocks = 0;
  for (const f of files) {
    if (isJsLike(f.relPath) || /\.(java|kt|kts|cpp|cc|cxx|hpp|h|cs|scala|dart)$/.test(f.relPath)) {
      funcs += (f.content.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+\w+/gm) ?? []).length;
      funcs += (f.content.match(/^\s*(?:public|private|protected|internal|static|fun|def)\s+[\w<>]+\s+\w+\s*\(/gm) ?? []).length;
      docBlocks += (f.content.match(/\/\*\*[\s\S]*?\*\//g) ?? []).length;
    } else if (/\.pyi?$/.test(f.relPath)) {
      funcs += (f.content.match(/^\s*(?:async\s+)?def\s+\w+/gm) ?? []).length;
      docBlocks += (f.content.match(/"""[\s\S]*?"""/g) ?? []).length;
      docBlocks += (f.content.match(/'''[\s\S]*?'''/g) ?? []).length;
    } else if (/\.go$/.test(f.relPath)) {
      funcs += (f.content.match(/^\s*func\s+(?:\([^)]+\)\s+)?\w+/gm) ?? []).length;
      docBlocks += (f.content.match(/(?:^\s*\/\/[^\n]*\n)+\s*func\s+/gm) ?? []).length;
    } else if (/\.rs$/.test(f.relPath)) {
      funcs += (f.content.match(/^\s*(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+\w+/gm) ?? []).length;
      docBlocks += (f.content.match(/(?:^\s*\/\/\/[^\n]*\n)+/gm) ?? []).length;
    } else if (/\.swift$/.test(f.relPath)) {
      funcs += (f.content.match(/^\s*(?:public|private|internal|fileprivate|open)?\s*func\s+\w+/gm) ?? []).length;
      docBlocks += (f.content.match(/(?:^\s*\/\/\/[^\n]*\n)+/gm) ?? []).length;
    } else if (/\.rb$/.test(f.relPath)) {
      funcs += (f.content.match(/^\s*def\s+\w+/gm) ?? []).length;
      docBlocks += (f.content.match(/(?:^\s*#[^\n]*\n)+\s*def\s+/gm) ?? []).length;
    }
  }
  if (funcs === 0) return 0;
  return Math.min(1, docBlocks / funcs);
}

function detectDocTagCounts(files: readonly SourceFile[]): Readonly<Record<string, number>> {
  const tags = ['@param', '@returns', '@throws', '@example', '@see', '@deprecated'];
  const counts: Record<string, number> = {};
  for (const tag of tags) {
    let c = 0;
    for (const f of files) {
      if (!isJsLike(f.relPath) && !/\.(java|kt|kts|cpp|cs|scala|dart)$/.test(f.relPath)) continue;
      c += (f.content.match(new RegExp(tag, 'g')) ?? []).length;
    }
    counts[tag] = c;
  }
  for (const section of ['Args:', 'Returns:', 'Raises:', 'Examples:']) {
    let c = 0;
    for (const f of files) {
      if (!/\.pyi?$/.test(f.relPath)) continue;
      c += (f.content.match(new RegExp(section, 'g')) ?? []).length;
    }
    if (c > 0) counts[section] = c;
  }
  let goDeprecated = 0;
  let rustErrors = 0;
  let rustSafety = 0;
  for (const f of files) {
    if (/\.go$/.test(f.relPath)) {
      goDeprecated += (f.content.match(/Deprecated:/g) ?? []).length;
    } else if (/\.rs$/.test(f.relPath)) {
      rustErrors += (f.content.match(/^\s*\/\/\/\s*#\s*Errors/gm) ?? []).length;
      rustSafety += (f.content.match(/^\s*\/\/\/\s*#\s*Safety/gm) ?? []).length;
    }
  }
  if (goDeprecated > 0) counts['Deprecated:'] = goDeprecated;
  if (rustErrors > 0) counts['# Errors'] = rustErrors;
  if (rustSafety > 0) counts['# Safety'] = rustSafety;
  return counts;
}

function detectImportOrder(files: readonly SourceFile[]): Conventions['importOrder'] {
  let nodeFirst = 0;
  let externalFirst = 0;
  for (const f of files) {
    if (!isJsLike(f.relPath)) continue;
    const lines = f.content.split('\n');
    let firstNode = -1;
    let firstExternal = -1;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t.startsWith('import ')) continue;
      const m = t.match(/from\s+['"]([^'"]+)['"]/);
      if (!m) continue;
      const src = m[1];
      if (src.startsWith('node:')) {
        if (firstNode === -1) firstNode = i;
      } else if (!src.startsWith('.') && !src.startsWith('/')) {
        if (firstExternal === -1) firstExternal = i;
      }
    }
    if (firstNode !== -1 && firstExternal !== -1) {
      if (firstNode < firstExternal) nodeFirst++;
      else externalFirst++;
    }
  }
  if (nodeFirst === 0 && externalFirst === 0) return 'unknown';
  if (nodeFirst > externalFirst * 2) return 'node-first';
  if (externalFirst > nodeFirst * 2) return 'external-first';
  return 'mixed';
}

function detectExportPattern(files: readonly SourceFile[]): Conventions['exportPattern'] {
  let named = 0;
  let defaults = 0;
  for (const f of files) {
    if (!isJsLike(f.relPath)) continue;
    named += (f.content.match(/^\s*export\s+(?:const|function|let|class|interface|type|enum)\s/gm) ?? [])
      .length;
    defaults += (f.content.match(/^\s*export\s+default\s/gm) ?? []).length;
  }
  if (defaults === 0 && named > 0) return 'named-only';
  if (named === 0 && defaults > 0) return 'default-primary';
  if (defaults > named) return 'default-primary';
  if (defaults > 0) return 'default-mixed';
  return 'unknown';
}

function detectErrorHandling(files: readonly SourceFile[]): Conventions['errorHandling'] {
  let throws = 0;
  let results = 0;
  for (const f of files) {
    if (!isJsLike(f.relPath)) continue;
    throws += (f.content.match(/\bthrow\s+new\s+/g) ?? []).length;
    results += (f.content.match(/return\s+\{\s*(?:ok|success|pass)\s*:\s*(?:false|true)/g) ?? []).length;
  }
  if (throws > results * 3) return 'throw-primary';
  if (results > throws * 2) return 'result-pattern';
  return 'mixed';
}

function detectTypeDefLocation(files: readonly SourceFile[]): Conventions['typeDefLocation'] {
  const typesFiles = files.filter((f) => /\btypes?\.ts$/.test(f.relPath));
  const inlineTypeFiles = files.filter((f) =>
    isJsLike(f.relPath) && /^\s*(?:export\s+)?(?:interface|type)\s+\w+/m.test(f.content),
  );
  if (typesFiles.length === 0) return 'inline';
  if (typesFiles.length >= 2 && inlineTypeFiles.length < typesFiles.length * 5) return 'types-file';
  return 'mixed';
}

function detectFileHeaderPattern(files: readonly SourceFile[]): string | null {
  const samples: string[] = [];
  for (const f of files.slice(0, 20)) {
    if (!isJsLike(f.relPath)) continue;
    const firstLine = f.content.split('\n', 1)[0]?.trim() ?? '';
    if (firstLine.startsWith('//') || firstLine.startsWith('/*')) samples.push(firstLine);
  }
  if (samples.length === 0) return null;
  const prefixCount = new Map<string, number>();
  for (const s of samples) {
    const p = s.slice(0, 24);
    prefixCount.set(p, (prefixCount.get(p) ?? 0) + 1);
  }
  let best: [string, number] | null = null;
  for (const entry of prefixCount) {
    if (!best || entry[1] > best[1]) best = entry;
  }
  return best ? best[0] : null;
}

function detectTestLocation(files: readonly SourceFile[]): Conventions['testLocation'] {
  let sibling = 0;
  let tests = 0;
  for (const f of files) {
    if (/\.test\.[jt]sx?$/.test(f.relPath)) {
      if (f.relPath.startsWith(`tests${sep}`) || f.relPath.includes(`${sep}tests${sep}`)) tests++;
      else sibling++;
    }
  }
  if (sibling === 0 && tests === 0) return 'none';
  if (sibling > 0 && tests > 0) return 'tests-and-sibling';
  if (tests > 0) return 'tests-dir';
  return 'sibling-test';
}

function detectModuleBoilerplate(files: readonly SourceFile[]): string | null {
  const candidates = files
    .filter((f) => isJsLike(f.relPath) && /^\/\//.test(f.content) && /\bexport\s+/.test(f.content))
    .sort((a, b) => a.loc - b.loc);
  const pick = candidates[0];
  if (!pick) return null;
  return pick.content.split('\n').slice(0, 40).join('\n');
}
