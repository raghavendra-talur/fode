// Package server exposes the SQLite-backed entity graph over HTTP. Routes are
// thin wrappers around internal/db; the analyzer is invoked synchronously
// from POST /api/repos.
package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/raghavendra-talur/fode/internal/analyzer"
	"github.com/raghavendra-talur/fode/internal/db"
)

type Server struct {
	db *sql.DB
}

func New(database *sql.DB) *Server {
	return &Server{db: database}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/repos", s.listRepos)
	mux.HandleFunc("POST /api/repos", s.createRepo)
	mux.HandleFunc("GET /api/repos/{id}", s.getRepo)
	mux.HandleFunc("GET /api/repos/{id}/entities", s.listEntities)
	mux.HandleFunc("GET /api/repos/{id}/search", s.search)
	mux.HandleFunc("GET /api/repos/{id}/graph", s.repoGraph)
	mux.HandleFunc("GET /api/repos/{id}/reviews", s.listRepoReviews)
	mux.HandleFunc("GET /api/repos/{id}/deadcode", s.repoDeadCode)
	mux.HandleFunc("GET /api/entities", s.getEntity)
	mux.HandleFunc("GET /api/entities/focus", s.entityFocus)
	mux.HandleFunc("GET /api/entities/source", s.entitySource)
	mux.HandleFunc("GET /api/entities/refs", s.entityRefs)
	mux.HandleFunc("GET /api/entities/review", s.getReview)
	mux.HandleFunc("PUT /api/entities/review", s.putReview)
	mux.HandleFunc("DELETE /api/entities/review", s.deleteReview)
	mux.HandleFunc("GET /api/entities/comments", s.listComments)
	mux.HandleFunc("POST /api/entities/comments", s.createComment)
	mux.HandleFunc("DELETE /api/comments/{cid}", s.deleteComment)
	mux.HandleFunc("GET /api/entities/edit", s.getEdit)
	mux.HandleFunc("PUT /api/entities/edit", s.putEdit)
	mux.HandleFunc("DELETE /api/entities/edit", s.deleteEdit)
	mux.HandleFunc("POST /api/entities/edit/apply", s.applyEdit)
	return cors(mux)
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) listRepos(w http.ResponseWriter, r *http.Request) {
	repos, err := db.ListRepos(s.db)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, repos)
}

func (s *Server) createRepo(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON: %v", err))
		return
	}
	if req.Path == "" {
		writeError(w, http.StatusBadRequest, "path is required")
		return
	}
	result, err := analyzer.Analyze(req.Path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	repoID, err := db.WriteAnalysis(s.db, result)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	repo, err := db.GetRepo(s.db, repoID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, repo)
}

func (s *Server) getRepo(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	repo, err := db.GetRepo(s.db, id)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "repo not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, repo)
}

func (s *Server) listEntities(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	ents, err := db.ListEntities(s.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ents)
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	q := r.URL.Query().Get("q")
	results, err := db.Search(s.db, id, q)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (s *Server) repoGraph(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	g, err := db.BuildGraph(s.db, id)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "repo not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, g)
}

func (s *Server) getEntity(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}
	e, err := db.GetEntity(s.db, id)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "entity not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, e)
}

func (s *Server) entityFocus(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}
	v, err := db.FocusOf(s.db, id)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "entity not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) repoDeadCode(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	report, err := db.DeadCode(s.db, id)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "repo not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, report)
}

func (s *Server) entityRefs(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}
	refs, err := db.ListRefs(s.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, refs)
}

func (s *Server) entitySource(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}
	e, err := db.GetEntity(s.db, id)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "entity not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"source": e.Source})
}
