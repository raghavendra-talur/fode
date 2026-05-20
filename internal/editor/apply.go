// Package editor flushes draft edits back to disk. The byte-range splice
// happens against the file's current contents at [byte_start, byte_end];
// if the on-disk bytes no longer match the snapshot we took when the draft
// was created we abort with ErrBaseDrift so the user reconciles before
// overwriting.
package editor

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/raghavendra-talur/fode/internal/analyzer"
	"github.com/raghavendra-talur/fode/internal/db"
)

var ErrBaseDrift = errors.New("file changed on disk since the draft was created")

type ApplyResult struct {
	Applied         bool   `json:"applied"`
	EditID          int64  `json:"edit_id"`
	RepoID          int64  `json:"repo_id"`
	EntityID        string `json:"entity_id"`
	NewEntityCount  int    `json:"new_entity_count"`
	NewRelationCount int   `json:"new_relation_count"`
}

// Apply flushes the draft for entityID: splices draft_source into the source
// file at the entity's byte range, atomically renames it into place, marks
// the edit as applied, and triggers a full re-analysis of the repo so the
// rest of the entity graph stays consistent.
func Apply(d *sql.DB, entityID string) (*ApplyResult, error) {
	var (
		editID     int64
		base       string
		draft      string
		file       string
		byteStart  int
		byteEnd    int
		repoID     int64
		repoPath   string
	)
	err := d.QueryRow(`
		SELECT ed.id, ed.base_source, ed.draft_source,
		       e.file, e.byte_start, e.byte_end,
		       r.id, r.path
		FROM edits ed
		JOIN entities e ON e.id = ed.entity_id
		JOIN repos    r ON r.id = e.repo_id
		WHERE ed.entity_id = ? AND ed.status = ?
		ORDER BY ed.created_at DESC
		LIMIT 1
	`, entityID, db.EditStatusDraft).Scan(
		&editID, &base, &draft, &file, &byteStart, &byteEnd, &repoID, &repoPath,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.New("no draft to apply for this entity")
	}
	if err != nil {
		return nil, err
	}

	absPath := filepath.Join(repoPath, file)
	current, err := os.ReadFile(absPath)
	if err != nil {
		return nil, fmt.Errorf("read source file: %w", err)
	}

	if byteStart < 0 || byteEnd > len(current) || byteStart > byteEnd {
		return nil, ErrBaseDrift
	}
	if string(current[byteStart:byteEnd]) != base {
		return nil, ErrBaseDrift
	}

	// Splice draft_source into [byte_start, byte_end].
	newLen := len(current) - (byteEnd - byteStart) + len(draft)
	newContent := make([]byte, 0, newLen)
	newContent = append(newContent, current[:byteStart]...)
	newContent = append(newContent, draft...)
	newContent = append(newContent, current[byteEnd:]...)

	// Preserve the original file mode.
	info, err := os.Stat(absPath)
	if err != nil {
		return nil, err
	}
	mode := info.Mode().Perm()

	tmp := absPath + ".fode-tmp"
	if err := os.WriteFile(tmp, newContent, mode); err != nil {
		return nil, fmt.Errorf("write tmp: %w", err)
	}
	if err := os.Rename(tmp, absPath); err != nil {
		_ = os.Remove(tmp)
		return nil, fmt.Errorf("rename: %w", err)
	}

	if err := db.MarkEditApplied(d, editID); err != nil {
		return nil, fmt.Errorf("mark applied: %w", err)
	}

	// Re-analyze the repo so the entity graph + every derived view stays
	// consistent with the file we just wrote.
	result, err := analyzer.Analyze(repoPath)
	if err != nil {
		return nil, fmt.Errorf("re-analyze: %w", err)
	}
	if _, err := db.WriteAnalysis(d, result); err != nil {
		return nil, fmt.Errorf("persist re-analysis: %w", err)
	}

	return &ApplyResult{
		Applied:          true,
		EditID:           editID,
		RepoID:           repoID,
		EntityID:         entityID,
		NewEntityCount:   len(result.Entities),
		NewRelationCount: len(result.Relations),
	}, nil
}
