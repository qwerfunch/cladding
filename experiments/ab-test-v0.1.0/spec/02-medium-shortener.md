# Sample 02 — URL Shortener REST API (Medium)

> Same protocol as sample 01: identical prompt body to all three modes, 60-minute time-box, autonomous work.

## Prompt body

Build a URL shortener as a TypeScript REST API. Use Hono (or Fastify if you prefer) for the HTTP layer. Persist to a single `.shortener.json` file in the cwd — the in-memory map is rehydrated on startup. Before writing endpoints, set up the project (`npm init -y`, `tsconfig.json` with strict mode, `vitest`, eslint).

The API runs on `http://localhost:3000` by default; the port is configurable via the `PORT` env var.

## Acceptance criteria

| id | EARS | sentence |
|---|---|---|
| AC-1 | ubiquitous | The system shall serve an HTTP API on the configured port. |
| AC-2 | event | When the client POSTs `/shorten` with `{ url: <string> }`, the system shall return `201 { slug, shortUrl }` where `slug` is a 7-char alphanumeric id. |
| AC-3 | event | When the client GETs `/<slug>` for a known slug, the system shall respond `302` with the `Location` header set to the original URL. |
| AC-4 | event | When the client GETs `/<slug>` for an unknown slug, the system shall respond `404`. |
| AC-5 | ubiquitous | The system shall reject POST bodies whose `url` is not a syntactically valid http/https URL with `400`. |
| AC-6 | optional | Where the same URL is shortened twice, the system shall return the same slug both times (deterministic-by-input). |
| AC-7 | ubiquitous | The system shall persist the slug→URL map to disk after every successful POST. |
| AC-8 | ubiquitous | The system shall reload the persisted map on startup, so previously created slugs survive a restart. |
| AC-9 | event | When the client GETs `/_/stats`, the system shall respond `200 { total: <int>, recent: [<slug>, …] }` listing up to 10 most-recent slugs. |
| AC-10 | event | When the client GETs `/_/health`, the system shall respond `200 { ok: true }`. |
| AC-11 | unwanted | If the persistence write fails, the system shall log the error and return `500` to the originating request. |
| AC-12 | ubiquitous | The system shall expose at least one vitest end-to-end test per endpoint, all passing. |

## Constraints

- `tsc --noEmit` exit 0; `eslint .` exit 0; vitest tests all green.
- The server must be startable via `npm start` (script defined in `package.json`).
- A small README explains how to run, test, and configure the port.
- Time-box: 60 minutes.
