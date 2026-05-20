# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What fode is now

An entity-level code editor and reviewer for Go repos. The product surface
is: open a Go module, navigate by entities (functions, methods, types,
interfaces, packages) and their relations, attach reviews/comments to
entities, and edit entity source through the UI with changes flushed back to
disk.

Single language (Go). Single source of truth (SQLite).

This is a rewrite of an earlier Tauri + tree-sitter desktop app. The old
multi-language syntactic analyzer and Rust/JS frontend are gone. Don't
reintroduce tree-sitter, multi-language support, Rust code, or Tauri.

## Build & Run

There is no dedicated CLI to memorize — every dev command goes through
`make`. `make help` lists targets.

```
make install-deps   # go mod download + npm install in ui/
make dev            # API on :9100 + Vite on :9101 in parallel
make analyze REPO=/path/to/some/go/project
make build          # bin/fode + ui/dist
make test           # go test ./... + vitest
```

The Vite dev server proxies `/api/*` to `localhost:9100`, so the React app
just calls `fetch('/api/...')` in both dev and prod.

## Architecture

Top-level layout:

```
cmd/                 cobra subcommands (root, analyze, serve)
internal/
  analyzer/          go/packages → entities + relations
  db/                SQLite store (schema.sql is the contract)
  server/            net/http REST handlers
  editor/            applies entity edits back to source files
ui/                  React + Vite + TS SPA
Makefile             only sanctioned dev/build entrypoint
```

### Data flow

1. `fode analyze <path>` loads the Go module via
   `packages.Load` with `NeedTypes|NeedSyntax|NeedTypesInfo|NeedDeps|NeedImports|NeedModule|NeedFiles`.
2. The analyzer walks `pkg.Syntax` for entities (stable IDs:
   `"{relPath}::{kindLabel}::{name}"`) and `pkg.TypesInfo.Uses` for
   relations. This is the part that previously required ~500 lines of
   hand-rolled tree-sitter qualifier matching; with `go/packages` it's
   a straight iteration because the type checker already resolved
   everything.
3. The analyzer writes everything to SQLite in one transaction. Re-analysis
   is idempotent on `entity.id`.
4. `fode serve` exposes the DB via JSON endpoints under `/api/`.
5. React reads + mutates via `fetch`. Reviews, comments, and edit drafts
   are persisted in the same DB, keyed by `entity_id` so they survive
   re-analysis as long as path + name + kind don't change.

### Two halves of the DB

`schema.sql` is the contract — read it first when adding any feature.

- **Analyzer-owned** (`repos`, `entities`, `relations`, `external_deps`):
  recomputed on every `fode analyze`. Treat these tables as derived data.
- **User-owned** (`reviews`, `comments`, `edits`): authored from the UI,
  preserved across re-analyses. Foreign-keyed by `entity_id`.

When changing the schema, add the new statement to `schema.sql` (it uses
`CREATE … IF NOT EXISTS` so it's safe to re-run) and bump
`repos.schema_version` if existing data needs handling.

### Three-tier focus view (the key UX abstraction, preserved from the old fode)

The focus endpoint partitions an entity's outgoing references into three
tiers — frontend rendering depends on this shape:

- **Tier 1 — same package** (`same_pkg`): every individual reference,
  compact `(id, kind, signature)`.
- **Tier 2 — same module, different package** (`same_module`): aggregated
  per target package as `(fn_count, type_count)`.
- **Tier 3 — external** (`external_deps`): raw import paths from the
  entity's source.

"Package" here means *repo-relative directory*, not the Go `package`
keyword. Two files with `package foo` in different directories are
different packages.

### Editor flush

Edits hit `internal/editor/apply.go`. The flow:
1. Validate the file's current bytes at `[entity.byte_start, byte_end]`
   still equal `edit.base_source` (reject 409 if not).
2. Splice `draft_source` in, atomic write (tmp + fsync + rename).
3. Trigger re-analysis of the repo.
4. Line numbers for later entities in the same file will shift; that's
   expected — IDs stay stable because they're path+kind+name.

## Current phase

All phases shipped: 1, 1.5, 2, 3.

- Phase 1: analyzer, SQLite store, read-only HTTP API, React UI with
  landing/search/focus/browse.
- Phase 1.5: graph view (`db.BuildGraph` + `ui/src/features/graph/Graph.tsx`
  with d3-force on a custom canvas). The synthetic `pkg::<package_dir>` nodes
  + Contains edges cluster the graph by package via the link force without a
  custom force.
- Phase 2: reviewer features. `reviews` + `comments` tables (in the schema
  since Phase 0) are now driven by:
  - `GET/PUT/DELETE /api/entities/review?id=…` (single)
  - `GET /api/repos/{id}/reviews` (bulk, used by the browse grid to render
    status dots + filter chips in one fetch)
  - `GET/POST /api/entities/comments?id=…` and `DELETE /api/comments/{cid}`
  - `ReviewPanel` + `Comments` in `ui/src/features/review/`, embedded in the
    Focus view's center column.

Status semantics: a review row exists with `status` in
`{todo, reviewed, flagged}`. No row = "unreviewed" (the frontend treats null
as that state). Notes autosave on textarea blur.

Phase 3 added the editor surface. `internal/editor/apply.go` is the
load-bearing piece — given an entity ID with a draft, it:
1. Loads the edit + entity + repo path from the DB.
2. Reads the source file's current bytes at `[byte_start, byte_end]` and
   verifies they still equal the snapshot `base_source` taken when the draft
   was created (returns `ErrBaseDrift` → HTTP 409 if not).
3. Splices `draft_source` into the byte range, writes the new content to a
   `<file>.fode-tmp`, then atomically renames over the original (preserving
   the file mode).
4. Marks the edit row as `applied`.
5. Re-runs `analyzer.Analyze` on the repo and calls `db.WriteAnalysis`,
   replacing the entire entities/relations/external_deps set. User-owned
   reviews/comments/edits are untouched and survive on stable entity IDs.

Endpoints (entity-keyed via query param, like reviews/comments):
- `GET    /api/entities/edit?id=…` — current draft or `null`.
- `PUT    /api/entities/edit?id=…` — upsert draft. New rows snapshot
  `base_source` from the entities table; existing draft rows update
  `draft_source` only (the snapshot is preserved for drift detection).
- `DELETE /api/entities/edit?id=…` — discard the draft.
- `POST   /api/entities/edit/apply?id=…` — apply (4xx on drift; 200 with the
  new entity/relation counts on success).

Monaco loads from CDN via `@monaco-editor/react` — the npm wrapper is small
(~17 KB added to the bundle); the editor itself is ~1 MB loaded lazily on
first edit. Both `Editor` (vs-dark theme, Go language) and the Save/Apply
buttons live in `ui/src/features/editor/EditPanel.tsx`. After Apply the UI
calls `queryClient.invalidateQueries()` blanket-style because re-analysis
touches everything.

Smoke test: `make analyze REPO=.` then `make dev` and open
<http://localhost:9101>. fode itself yields 77 entities + 155 relations + 5
package nodes (82 graph nodes, 232 graph edges).

## IPC contract: HTTP, not Tauri

The previous codebase used Tauri `invoke()`. That's gone. All
frontend↔backend calls go through `fetch('/api/...')`. When adding a new
capability:

1. Add the SQL or analyzer logic.
2. Add a handler under `internal/server/`.
3. Register the route on the `http.ServeMux` in `cmd/serve.go` (or wherever
   the mux gets wired up once it's non-trivial).
4. Add a typed fetch wrapper in `ui/src/api/` and a TanStack Query hook.

## Conventions worth knowing

- **Entity IDs include the file path.** Stable across runs as long as the
  file's repo-relative path doesn't change. UI links, review keys, and
  comment keys all depend on this.
- **Schema-first.** `schema.sql` is checked in and authoritative. Don't add
  ad-hoc migrations; extend the schema, keep statements idempotent.
- **Per-repo DB by default.** `<repo>/.fode/fode.db`. Override with
  `--db` on serve/analyze for a global DB.
- **No CGO.** Use `modernc.org/sqlite` (pure Go) when wiring up the DB
  driver in Phase 1. Keeps cross-compilation and `go install` painless.
- **One Makefile to rule them all.** Don't add per-package build scripts;
  add a target.
