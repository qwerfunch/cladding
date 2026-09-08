# Task: truncateSlug

Add a `truncateSlug(slug, max)` function to `src/slugify.ts` that shortens an
existing slug to fit a maximum length.

Acceptance criteria:

- **AC-1** — a slug longer than `max` is cut at the last hyphen that fits, so no
  partial word survives and the result never ends in a hyphen:
  `truncateSlug("hello-world-again", 12)` returns `"hello-world"`.
- **AC-2** — a slug already at or under `max` is returned unchanged, and a `max`
  below `1` is rejected with a `RangeError`.

Name each acceptance criterion in the title of the test that verifies it.
