# fode

An entity-level code editor and reviewer for Go repositories.

fode analyzes a Go module into an entity graph — functions, methods, types,
interfaces, packages, and the relations between them — persists it in SQLite,
and serves it to a React UI where you can navigate, comment on, and edit code
at the entity level rather than the file level.

## Architecture

- **Analyzer** (Go, `internal/analyzer/`) — uses `golang.org/x/tools/go/packages`
  to load a module with full type information, then extracts entities and
  resolves cross-package references via `pkg.TypesInfo`.
- **SQLite store** (`internal/db/`) — single source of truth for both
  analyzer output (entities, relations, external deps) and user-authored
  data (reviews, comments, edits). Schema in `internal/db/schema.sql`.
- **HTTP API** (`internal/server/`) — `net/http` server, JSON over REST.
- **Web UI** (`ui/`) — React + Vite SPA. Vite dev server proxies `/api` to
  the Go backend for HMR.

## Quick start

```
make install-deps          # go mod download + npm install
make dev                   # runs API on :9100 and Vite on :9101 in parallel
make analyze REPO=/path/to/some/go/project
```

Open <http://localhost:9101>.

## Make targets

`make help` lists everything. Common ones:

| target          | what it does                                          |
|-----------------|-------------------------------------------------------|
| `dev`           | API + Vite in parallel with HMR                       |
| `dev-api`       | just the Go server (`PORT=9100`)                      |
| `dev-ui`        | just the Vite dev server                              |
| `build`         | production binary (`bin/fode`) + SPA bundle           |
| `analyze REPO=` | run the analyzer on a Go module and write to the DB   |
| `schema`        | dump the current SQLite schema                        |
| `test`          | `go test ./...` + `vitest`                            |
| `clean`         | remove `bin/`, `ui/dist`, `ui/node_modules`, `.fode/` |

## Status

All phases shipped (1, 1.5, 2, 3): analyzer, SQLite persistence, HTTP API,
React UI with landing/search/focus/browse/graph, reviewer surface
(status/notes/comments) on each entity, and the entity-level editor (Monaco
+ draft + apply-to-disk + automatic re-analysis). See `CLAUDE.md` for the
working architecture.

## License

Apache-2.0
