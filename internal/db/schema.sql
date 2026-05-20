-- fode SQLite schema v1
-- Owned by the analyzer (entities, relations, external_deps, repos) and the UI
-- (reviews, comments, edits). Re-analysis is idempotent on entity.id; user-
-- authored rows survive re-runs as long as file path + name + kind don't change.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS repos (
  id              INTEGER PRIMARY KEY,
  path            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  module_name     TEXT,
  language        TEXT NOT NULL DEFAULT 'Go',
  analyzed_at     INTEGER NOT NULL,
  schema_version  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  id              TEXT PRIMARY KEY,
  repo_id         INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL,
  file            TEXT NOT NULL,
  line            INTEGER NOT NULL,
  end_line        INTEGER NOT NULL,
  byte_start      INTEGER NOT NULL,
  byte_end        INTEGER NOT NULL,
  source          TEXT NOT NULL,
  signature       TEXT NOT NULL,
  package         TEXT NOT NULL,
  package_dir     TEXT NOT NULL,
  doc_comment     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_entities_repo    ON entities(repo_id);
CREATE INDEX IF NOT EXISTS idx_entities_name    ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_pkgdir  ON entities(repo_id, package_dir);

CREATE TABLE IF NOT EXISTS relations (
  id              INTEGER PRIMARY KEY,
  repo_id         INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  from_id         TEXT NOT NULL,
  to_id           TEXT NOT NULL,
  kind            TEXT NOT NULL,
  UNIQUE (from_id, to_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_id);
CREATE INDEX IF NOT EXISTS idx_relations_to   ON relations(to_id);

CREATE TABLE IF NOT EXISTS external_deps (
  entity_id   TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  import_path TEXT NOT NULL,
  PRIMARY KEY (entity_id, import_path)
);

-- Resolved identifier occurrences inside an entity's source. start_off/end_off
-- are byte offsets relative to the entity source. Derived data, wiped via the
-- entities cascade like external_deps; powers go-to-definition in the UI.
CREATE TABLE IF NOT EXISTS refs (
  entity_id   TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  start_off   INTEGER NOT NULL,
  end_off     INTEGER NOT NULL,
  to_id       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refs_entity ON refs(entity_id);

-- Reviewer surface
CREATE TABLE IF NOT EXISTS reviews (
  entity_id   TEXT PRIMARY KEY,
  status      TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY,
  entity_id   TEXT NOT NULL,
  line        INTEGER,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(entity_id);

-- Editor surface: drafts not yet flushed to disk
CREATE TABLE IF NOT EXISTS edits (
  id            INTEGER PRIMARY KEY,
  entity_id     TEXT NOT NULL,
  base_source   TEXT NOT NULL,
  draft_source  TEXT NOT NULL,
  status        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  applied_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_edits_entity ON edits(entity_id);
