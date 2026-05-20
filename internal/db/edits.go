package db

import (
	"database/sql"
	"errors"
	"time"
)

const (
	EditStatusDraft   = "draft"
	EditStatusApplied = "applied"
)

type Edit struct {
	ID          int64  `json:"id"`
	EntityID    string `json:"entity_id"`
	BaseSource  string `json:"base_source"`
	DraftSource string `json:"draft_source"`
	Status      string `json:"status"`
	CreatedAt   int64  `json:"created_at"`
	AppliedAt   *int64 `json:"applied_at"`
}

// GetCurrentDraft returns the most recent unapplied draft for an entity, or
// nil if none. There's at most one draft per entity in practice — UpsertDraft
// updates the existing row instead of creating a second one.
func GetCurrentDraft(d *sql.DB, entityID string) (*Edit, error) {
	var (
		e         Edit
		appliedAt sql.NullInt64
	)
	err := d.QueryRow(`
		SELECT id, entity_id, base_source, draft_source, status, created_at, applied_at
		FROM edits
		WHERE entity_id = ? AND status = ?
		ORDER BY created_at DESC
		LIMIT 1
	`, entityID, EditStatusDraft).Scan(
		&e.ID, &e.EntityID, &e.BaseSource, &e.DraftSource, &e.Status, &e.CreatedAt, &appliedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if appliedAt.Valid {
		v := appliedAt.Int64
		e.AppliedAt = &v
	}
	return &e, nil
}

// UpsertDraft updates an existing draft for entityID if one exists; otherwise
// it creates a new draft using the current entity source (from the entities
// table) as the base_source snapshot.
func UpsertDraft(d *sql.DB, entityID, draftSource string) (*Edit, error) {
	existing, err := GetCurrentDraft(d, entityID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		if _, err := d.Exec(`UPDATE edits SET draft_source = ? WHERE id = ?`, draftSource, existing.ID); err != nil {
			return nil, err
		}
		existing.DraftSource = draftSource
		return existing, nil
	}

	var baseSource string
	err = d.QueryRow(`SELECT source FROM entities WHERE id = ?`, entityID).Scan(&baseSource)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	now := time.Now().Unix()
	res, err := d.Exec(`
		INSERT INTO edits (entity_id, base_source, draft_source, status, created_at)
		VALUES (?, ?, ?, ?, ?)
	`, entityID, baseSource, draftSource, EditStatusDraft, now)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &Edit{
		ID:          id,
		EntityID:    entityID,
		BaseSource:  baseSource,
		DraftSource: draftSource,
		Status:      EditStatusDraft,
		CreatedAt:   now,
	}, nil
}

func DiscardDraft(d *sql.DB, entityID string) error {
	_, err := d.Exec(`DELETE FROM edits WHERE entity_id = ? AND status = ?`, entityID, EditStatusDraft)
	return err
}

func MarkEditApplied(d *sql.DB, editID int64) error {
	_, err := d.Exec(`UPDATE edits SET status = ?, applied_at = ? WHERE id = ?`,
		EditStatusApplied, time.Now().Unix(), editID)
	return err
}
