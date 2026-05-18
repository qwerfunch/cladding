# Sample 03 — Mini Blog Backend (Large)

> Same protocol as 01/02. 120-minute time-box. Autonomous.

## Prompt body

Build a mini blog backend in TypeScript with Express + SQLite (`better-sqlite3`) + JWT auth. Before writing features, set up the project (`npm init -y`, `tsconfig.json` strict, `vitest`, eslint), the SQLite schema migration, and a basic project layout (routes / services / db / auth).

The server runs on `http://localhost:4000` by default; the port is configurable via `PORT`. JWT secret comes from `JWT_SECRET` (random fallback in dev).

## Schema

- `users(id, email UNIQUE, password_hash, created_at)`
- `posts(id, author_id FK→users, title, body, slug UNIQUE, created_at, updated_at)`
- `tags(id, name UNIQUE)`
- `post_tags(post_id, tag_id, PRIMARY KEY composite)`

## Acceptance criteria

| id | EARS | sentence |
|---|---|---|
| AC-1 | event | When the client POSTs `/auth/register` with `{ email, password }`, the system shall create a user, hash the password with bcrypt (cost ≥ 10), and return `201 { id, email }`. |
| AC-2 | event | When the client POSTs `/auth/login` with valid credentials, the system shall return `200 { token }` containing a signed JWT (expiry ≥ 1h). |
| AC-3 | unwanted | If the credentials are wrong, the system shall return `401 { error: 'invalid credentials' }` without revealing which field failed. |
| AC-4 | event | When the client POSTs `/posts` with a valid `Authorization: Bearer <token>` and `{ title, body, tags: string[] }`, the system shall create the post, auto-generate a slug from the title (lowercase, hyphens), and return `201 { id, slug }`. |
| AC-5 | event | When the client GETs `/posts/:slug`, the system shall return the post with its author email and tag names; `404` if not found. |
| AC-6 | event | When the client GETs `/posts?author=<email>`, the system shall return all that author's posts (most-recent first). |
| AC-7 | event | When the client GETs `/posts?tag=<name>`, the system shall return all posts carrying that tag. |
| AC-8 | event | When the client GETs `/posts?q=<text>`, the system shall return posts whose `title` or `body` contains the text (SQLite LIKE, case-insensitive). |
| AC-9 | event | When the client PATCHes `/posts/:slug` with valid auth as the author, the system shall update the title and/or body and bump `updated_at`. |
| AC-10 | unwanted | If a non-author tries to PATCH or DELETE a post, the system shall return `403`. |
| AC-11 | event | When the client DELETEs `/posts/:slug` as the author, the system shall delete the post and any `post_tags` rows referencing it. |
| AC-12 | optional | Where the request includes `Accept-Language: ko`, the system shall localise error messages to Korean (at least `invalid credentials`, `not found`, `forbidden`). |
| AC-13 | ubiquitous | The system shall reject any malformed JWT with `401`. |
| AC-14 | ubiquitous | The system shall reject any request body whose `title` is empty or longer than 200 characters. |
| AC-15 | ubiquitous | The system shall apply a rate limit of 30 requests / minute / IP to the `/auth/*` endpoints. |
| AC-16 | event | When the server boots and the schema is missing, the system shall apply the migrations idempotently. |
| AC-17 | ubiquitous | The system shall maintain a vitest suite with at least one passing test per AC above. |
| AC-18 | ubiquitous | The system shall ship `tsc --noEmit` exit 0. |
| AC-19 | ubiquitous | The system shall ship `eslint .` exit 0. |
| AC-20 | ubiquitous | The system shall expose `GET /_/health` returning `{ ok: true }`. |
| AC-21 | ubiquitous | The system shall expose `GET /_/stats` returning `{ users, posts, tags }` counts. |
| AC-22 | event | When the server crashes mid-write, the system shall not leave the SQLite database in an inconsistent state (use transactions). |
| AC-23 | optional | Where `LOG_LEVEL=debug`, the system shall print each query before execution. |
| AC-24 | ubiquitous | The system shall include a README explaining the schema, env vars, run command, and test command. |
| AC-25 | ubiquitous | The project shall be startable with one command: `npm start`. |

## Constraints

- TypeScript strict mode, eslint clean, vitest tests all green.
- No external services (Redis, etc.) — SQLite + in-process only.
- Time-box: 120 minutes.
