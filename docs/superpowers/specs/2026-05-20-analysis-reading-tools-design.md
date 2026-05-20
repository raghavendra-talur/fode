# Analysis & reading tools for fode

Date: 2026-05-20

Adds four features for better code analysis/reading/reviewing. Two of them
(#1, #7) surface relation data the analyzer already produces; two (#3, #6) are
net-new.

## Feature #1 + #7 — Distinct relation groups in the Focus view

The analyzer already emits `Calls`, `References`, and `Satisfies` relations, but
`FocusOf` collapses all incoming relations into one `incoming` list and silently
buckets outgoing `Satisfies` into the same-package / same-module package counts.

### Backend (`internal/db/store.go`)

Replace `FocusView.Incoming []Reference` with four typed lists:

- `callers []Reference` — incoming `Calls`.
- `referenced_by []Reference` — incoming `References`.
- `implementations []Reference` — incoming `Satisfies` (concrete types that
  satisfy this entity, when it is an interface).
- `satisfies []Reference` — outgoing `Satisfies` (interfaces this entity
  implements).

Outgoing `Satisfies` relations are excluded from the `same_pkg` / `same_module`
bucketing so those counts stop double-counting interfaces. `relationLabel` is
removed; grouping is by relation kind instead of a label string.

### Frontend (`ui/src/features/focus/Focus.tsx`, `ui/src/types.ts`)

- Left column renders "Callers", "Referenced by", and (when non-empty)
  "Implementations".
- Right column gains a "Satisfies / implements" section listing interfaces.
- `FocusView` type updated to match the new shape.

## Feature #3 — Dead-code report

### Backend (`internal/db/store.go`, `internal/server/server.go`)

New `db.DeadCode(repoID)` returning `{ dead: []Entity, exported_unused: []Entity }`.

- Candidates: entities with **zero incoming relations**.
- Excluded:
  - functions named `main` or `init`;
  - methods whose receiver base type has an outgoing `Satisfies` relation
    (interface-reachable — a documented heuristic; a method called only through
    an interface has no direct incoming `Calls`).
- Classification by the last name segment (the part after `.` for methods):
  uppercase first rune → `exported_unused`, otherwise → `dead`.

Route: `GET /api/repos/{id}/deadcode`. Frontend wrapper `api.deadCode(id)`.

### Frontend (`ui/src/pages/RepoView.tsx`, new `DeadCode` feature)

Add a "Dead code" tab next to Browse / Graph. Renders the two sections; each row
is clickable through to the Focus view.

## Feature #6 — Go-to-definition in the source view

### Analyzer (`internal/analyzer/`)

In `extractRelationsFile`, for every identifier that already resolves to an
in-repo entity (the existing `defIDs[obj]` lookup), also emit a reference record:

```go
type Ref struct {
    EntityID string // enclosing entity
    Start    int    // byte offset relative to entity source
    End      int
    ToID     string // referenced entity
}
```

`Start = identOffset − entityByteStart`, `End = Start + identLen`, where
`entityByteStart` comes from a `map[entityID]int` built from the already-extracted
entities and passed into the relations pass. References are collected un-deduped
(one per source occurrence) on `Result.References`. A guard drops any ref whose
`[Start,End)` falls outside `[0, len(entitySource))` — this can happen for the
trailing specs of a multi-spec `type (...)` / `var (...)` block, which the
relations pass attributes to the first spec's entity.

### Schema (`internal/db/schema.sql`)

New derived table, modeled on `external_deps` (wiped via the entities cascade, so
no migration is needed):

```sql
CREATE TABLE IF NOT EXISTS refs (
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  start_off INTEGER NOT NULL,
  end_off   INTEGER NOT NULL,
  to_id     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refs_entity ON refs(entity_id);
```

`SchemaVersion` is bumped to 2 per convention. `WriteAnalysis` inserts refs in
the same transaction that writes entities/relations.

### Backend

`GET /api/entities/refs?id=…` → `[{ start, end, to_id }]`, ordered by `start`.

### Frontend (`ui/src/features/focus/`, new `SourceView` component)

`SourceView` replaces the `<pre className="source">` in read mode (edit mode
keeps Monaco unchanged). Given the entity source and its refs, it:

1. Encodes the source with `TextEncoder` to a byte array (offsets are byte
   offsets, so this keeps multibyte source correct).
2. Walks the refs sorted by `start`, slicing `[prevEnd, start)` as plain text and
   `[start, end)` as a clickable span, decoding each slice with `TextDecoder`.
3. Clicking a span calls `onSelect(to_id)` — the same navigation used elsewhere.

## Testing

- Analyzer unit tests (new `internal/analyzer/*_test.go`) over a small Go fixture:
  verify ref offsets slice back to the referenced identifier text, and verify
  dead-code classification (main/init excluded, interface-reachable method
  excluded, exported vs unexported split).
- `make analyze REPO=.` smoke still yields 77 entities / 155 relations / 5 package
  nodes; `refs` is populated and non-empty.
- `make test` (go + vitest) passes.

## Out of scope

- No new relation kinds beyond the existing `Calls` / `References` / `Satisfies`.
- Go-to-definition links only to in-repo entities (external references render as
  plain text), since `defIDs` only contains the analyzed module's objects.
