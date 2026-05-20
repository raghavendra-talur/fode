package db

import (
	"database/sql"
	"errors"
	"time"
)

const (
	StatusTodo     = "todo"
	StatusReviewed = "reviewed"
	StatusFlagged  = "flagged"
)

type Review struct {
	EntityID  string `json:"entity_id"`
	Status    string `json:"status"`
	Notes     string `json:"notes"`
	UpdatedAt int64  `json:"updated_at"`
}

type Comment struct {
	ID        int64  `json:"id"`
	EntityID  string `json:"entity_id"`
	Line      *int   `json:"line"`
	Body      string `json:"body"`
	CreatedAt int64  `json:"created_at"`
}

func ValidStatus(s string) bool {
	return s == StatusTodo || s == StatusReviewed || s == StatusFlagged
}

// GetReview returns nil + nil error when no review row exists — the frontend
// treats that as "unreviewed".
func GetReview(d *sql.DB, entityID string) (*Review, error) {
	var r Review
	err := d.QueryRow(`
		SELECT entity_id, status, notes, updated_at
		FROM reviews WHERE entity_id = ?
	`, entityID).Scan(&r.EntityID, &r.Status, &r.Notes, &r.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func UpsertReview(d *sql.DB, entityID, status, notes string) (*Review, error) {
	if !ValidStatus(status) {
		return nil, errors.New("invalid status")
	}
	now := time.Now().Unix()
	_, err := d.Exec(`
		INSERT INTO reviews (entity_id, status, notes, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(entity_id) DO UPDATE SET
			status = excluded.status,
			notes = excluded.notes,
			updated_at = excluded.updated_at
	`, entityID, status, notes, now)
	if err != nil {
		return nil, err
	}
	return &Review{EntityID: entityID, Status: status, Notes: notes, UpdatedAt: now}, nil
}

func DeleteReview(d *sql.DB, entityID string) error {
	_, err := d.Exec(`DELETE FROM reviews WHERE entity_id = ?`, entityID)
	return err
}

// ListReviewsForRepo returns every review row whose entity belongs to repoID.
// Used to render review-status indicators across the browse grid in one fetch.
func ListReviewsForRepo(d *sql.DB, repoID int64) ([]Review, error) {
	rows, err := d.Query(`
		SELECT r.entity_id, r.status, r.notes, r.updated_at
		FROM reviews r
		JOIN entities e ON e.id = r.entity_id
		WHERE e.repo_id = ?
	`, repoID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Review{}
	for rows.Next() {
		var r Review
		if err := rows.Scan(&r.EntityID, &r.Status, &r.Notes, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func ListComments(d *sql.DB, entityID string) ([]Comment, error) {
	rows, err := d.Query(`
		SELECT id, entity_id, line, body, created_at
		FROM comments WHERE entity_id = ?
		ORDER BY created_at ASC, id ASC
	`, entityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Comment{}
	for rows.Next() {
		var c Comment
		var line sql.NullInt64
		if err := rows.Scan(&c.ID, &c.EntityID, &line, &c.Body, &c.CreatedAt); err != nil {
			return nil, err
		}
		if line.Valid {
			v := int(line.Int64)
			c.Line = &v
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func CreateComment(d *sql.DB, entityID, body string, line *int) (*Comment, error) {
	if body == "" {
		return nil, errors.New("body is required")
	}
	now := time.Now().Unix()
	var lineVal any
	if line != nil {
		lineVal = *line
	}
	res, err := d.Exec(`
		INSERT INTO comments (entity_id, line, body, created_at)
		VALUES (?, ?, ?, ?)
	`, entityID, lineVal, body, now)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &Comment{ID: id, EntityID: entityID, Line: line, Body: body, CreatedAt: now}, nil
}

func DeleteComment(d *sql.DB, id int64) error {
	_, err := d.Exec(`DELETE FROM comments WHERE id = ?`, id)
	return err
}
