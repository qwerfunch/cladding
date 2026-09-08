# Task: slugify

Add a `slugify` function to `src/slugify.ts` that turns a human-readable title
into a URL slug.

Acceptance criteria:

- **AC-1** — `slugify("Hello World!")` returns `"hello-world"`: the result is
  lower-case, punctuation is dropped, and runs of whitespace become single
  hyphens.
- **AC-2** — diacritics are folded to their base letters, so
  `slugify("Crème Brûlée")` returns `"creme-brulee"`.
- **AC-3** — an input that contains no slug-able characters (for example `"   "`)
  is rejected: `slugify` throws an `EmptySlugError` rather than returning an
  empty string.

Name each acceptance criterion in the title of the test that verifies it.
