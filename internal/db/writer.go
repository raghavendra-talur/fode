package db

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/raghavendra-talur/fode/internal/analyzer"
)

// WriteAnalysis upserts the repo row, wipes its existing analyzer-owned data
// (entities cascade to relations + external_deps via the schema), and inserts
// the new graph. User-owned tables (reviews, comments, edits) are untouched
// and survive re-analysis on stable entity IDs.
func WriteAnalysis(d *sql.DB, result *analyzer.Result) (int64, error) {
	tx, err := d.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback() //nolint:errcheck

	now := time.Now().Unix()

	var repoID int64
	err = tx.QueryRow(`
		INSERT INTO repos (path, name, module_name, language, analyzed_at, schema_version)
		VALUES (?, ?, ?, 'Go', ?, ?)
		ON CONFLICT(path) DO UPDATE SET
			name = excluded.name,
			module_name = excluded.module_name,
			analyzed_at = excluded.analyzed_at,
			schema_version = excluded.schema_version
		RETURNING id
	`, result.Repo.Path, result.Repo.Name, result.Repo.ModuleName, now, SchemaVersion).Scan(&repoID)
	if err != nil {
		return 0, fmt.Errorf("upsert repo: %w", err)
	}

	// Relations FK only to repos, so wipe explicitly. external_deps FKs to
	// entities with ON DELETE CASCADE, so the entities wipe handles it.
	if _, err := tx.Exec(`DELETE FROM relations WHERE repo_id = ?`, repoID); err != nil {
		return 0, fmt.Errorf("clear relations: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM entities WHERE repo_id = ?`, repoID); err != nil {
		return 0, fmt.Errorf("clear entities: %w", err)
	}

	entStmt, err := tx.Prepare(`
		INSERT INTO entities
		  (id, repo_id, name, kind, file, line, end_line, byte_start, byte_end,
		   source, signature, package, package_dir, doc_comment)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return 0, err
	}
	defer entStmt.Close()
	for _, e := range result.Entities {
		if _, err := entStmt.Exec(
			e.ID, repoID, e.Name, e.Kind, e.File, e.Line, e.EndLine,
			e.ByteStart, e.ByteEnd, e.Source, e.Signature, e.Package, e.PackageDir, e.DocComment,
		); err != nil {
			return 0, fmt.Errorf("insert entity %s: %w", e.ID, err)
		}
	}

	relStmt, err := tx.Prepare(`
		INSERT OR IGNORE INTO relations (repo_id, from_id, to_id, kind)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return 0, err
	}
	defer relStmt.Close()
	for _, r := range result.Relations {
		if _, err := relStmt.Exec(repoID, r.FromID, r.ToID, r.Kind); err != nil {
			return 0, fmt.Errorf("insert relation: %w", err)
		}
	}

	depStmt, err := tx.Prepare(`
		INSERT OR IGNORE INTO external_deps (entity_id, import_path)
		VALUES (?, ?)
	`)
	if err != nil {
		return 0, err
	}
	defer depStmt.Close()
	for eid, paths := range result.ExternalDeps {
		for _, p := range paths {
			if _, err := depStmt.Exec(eid, p); err != nil {
				return 0, fmt.Errorf("insert external_dep: %w", err)
			}
		}
	}

	refStmt, err := tx.Prepare(`
		INSERT INTO refs (entity_id, start_off, end_off, to_id)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return 0, err
	}
	defer refStmt.Close()
	for _, ref := range result.Refs {
		if _, err := refStmt.Exec(ref.EntityID, ref.Start, ref.End, ref.ToID); err != nil {
			return 0, fmt.Errorf("insert ref: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return repoID, nil
}
