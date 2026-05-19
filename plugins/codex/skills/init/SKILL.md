---
description: Scaffold a cladding workspace in the current directory — seed spec.yaml, create .cladding/, append gitignore entries. Use when the user wants to start a new Ironclad project or add cladding to an existing repo.
---

# Cladding init

Run `clad init` from the directory where the cladding workspace should live. Idempotent — skips files that already exist unless `--force` is supplied.

- `--name <name>` — override the project name (default: cwd basename).
- `--force` — overwrite an existing `spec.yaml`.

After init:

1. Edit `spec.yaml` to declare the first feature (`F-001`).
2. Run `clad sync` to verify the spec is valid.
3. Run `clad check` to see which Iron Law stages are wired up for the toolchain cladding detects in the cwd.

```
clad init
clad init --name my-project
clad init --force
```
