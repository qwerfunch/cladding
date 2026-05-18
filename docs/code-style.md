# Code style

This document is the single source of truth for code style and comment policy across cladding. AGENTS.md and `agents/specialists.md` both point here; if a contradiction appears, this file wins, and the others must be patched in the same change.

## Code style — Google Style Guides per language

Apply the [Google Style Guides](https://google.github.io/styleguide/) for every language that ships with cladding's polyglot toolchain. For languages without an official Google guide, follow the most-widely-adopted community style.

| language | guide |
|---|---|
| TypeScript / JavaScript | Google TypeScript / JavaScript Style |
| Python | Google Python Style |
| Java | Google Java Style |
| Go | Google Go Style |
| Shell / Bash | Google Shell Style |
| C++ / Objective-C | Google C++ / Objective-C Style |
| Rust | `rustfmt` default + Rust API Guidelines |
| PHP | PSR-12 |
| Ruby | community Ruby Style Guide |
| Elixir | `mix format` default + community style |
| .NET / C# | Microsoft C# coding conventions |

Polyglot toolchain detection lives in `stages/toolchain/detect.ts`. When you add support for a new language, add the row here in the same patch.

## Comment style

Six principles. Apply to source code in every language; doc-strings (TSDoc / JSDoc / pydoc / rustdoc / godoc / Javadoc) use the same principles in the language's native syntax.

### 1. Why > What

Write the intent, the decision rationale, and the constraint. Do not restate what the code already shows. A reader (human or AI) can run the code to learn *what* it does; only the source can explain *why*.

### 2. Use the full documentation field set

For every exported symbol, supply a meaningful doc block using the language's native documentation tags:

- TSDoc / JSDoc: `@param`, `@returns`, `@throws`, `@example`, `@see`, `@deprecated`, `@since`, `@internal`.
- pydoc: `Args:`, `Returns:`, `Raises:`, `Examples:`, `See Also:`, `.. deprecated::`, `.. versionadded::`.
- rustdoc: `# Arguments`, `# Returns`, `# Errors`, `# Examples`, `# Safety`, `[#[deprecated]]`.
- godoc: prose paragraphs with the `Deprecated:` convention.
- Javadoc: `@param`, `@return`, `@throws`, `@see`, `@since`, `@deprecated`.

A one-line summary in the doc block's first sentence is non-negotiable.

### 3. Spec linkage

When a decision traces to an external source of truth, cite it from the doc block:

- `@see spec/features/F-NNN.yaml AC-NNN` — the acceptance criterion driving this code.
- `@see ironclad-design/<section>.md` — the upstream design doc that motivated the shape.
- `@see iron-law.md stage_X.Y` — the Ironclad stage this code implements.
- `@see https://github.com/qwerfunch/ironclad/blob/main/<file>` — anything else in the upstream Ironclad repo.

The next agent that patches this code recovers the decision context from these links. This is the AI-era reinforcement that lets comments survive across many hands.

### 4. Invariant · precondition · assumption

State the non-obvious ones explicitly. Examples:

- *"caller guarantees the cwd is a git repo."*
- *"this function assumes the spec has already been validated."*
- *"the returned array is sorted by feature id ascending; downstream code relies on that order."*

A future reader (human or AI) cannot infer these from the code alone. If they could, the comment is redundant — don't write it.

### 5. Self-documenting code first

Meaningful names, short functions, types, enums. Comments fill the gaps those cannot fill. If you are tempted to write a comment to explain *what* a variable holds, rename the variable. If a function needs three paragraphs to describe its behaviour, split it.

### 6. Forbidden

These five patterns are noise and they go stale on the next edit:

- TODO markers (open an issue or a follow-up patch instead).
- Tentative markers in any language (`"임시"`, `"tentative"`, `"hack"`, `"will fix later"`).
- Date-bound notes (`"last year we…"`, `"as of Q3 2025…"`).
- Comments that paraphrase the code (`// add 1 to counter`).
- Anything whose accuracy depends on context the comment itself does not pin down.

## When this document changes

A patch to this document is a code-policy change. Treat it as a `Changed` entry under the next release in `CHANGELOG.md`, never a silent edit. Re-run `npm test`, `npm run typecheck`, and `npm run lint` after the change to confirm nothing in the lint/style chain regressed.
