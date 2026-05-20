package db

import (
	"database/sql"
	"errors"
	"path"
	"sort"
	"strings"

	"github.com/raghavendra-talur/fode/internal/analyzer"
)

var ErrNotFound = errors.New("not found")

type Repo struct {
	ID         int64  `json:"id"`
	Path       string `json:"path"`
	Name       string `json:"name"`
	ModuleName string `json:"module_name"`
	Language   string `json:"language"`
	AnalyzedAt int64  `json:"analyzed_at"`
}

type RepoSummary struct {
	ID            int64  `json:"id"`
	Path          string `json:"path"`
	Name          string `json:"name"`
	ModuleName    string `json:"module_name"`
	EntityCount   int    `json:"entity_count"`
	RelationCount int    `json:"relation_count"`
	AnalyzedAt    int64  `json:"analyzed_at"`
}

type SearchResult struct {
	Entity analyzer.Entity `json:"entity"`
	Score  float64         `json:"score"`
}

type Reference struct {
	Entity   analyzer.Entity `json:"entity"`
	Relation string          `json:"relation"`
}

type SamePkgEntry struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Signature string `json:"signature"`
}

type PkgGroup struct {
	PkgName   string `json:"pkg_name"`
	PkgDir    string `json:"pkg_dir"`
	FnCount   int    `json:"fn_count"`
	TypeCount int    `json:"type_count"`
}

type FocusView struct {
	Center       analyzer.Entity `json:"center"`
	Incoming     []Reference     `json:"incoming"`
	SamePkg      []SamePkgEntry  `json:"same_pkg"`
	SameModule   []PkgGroup      `json:"same_module"`
	ExternalDeps []string        `json:"external_deps"`
}

func ListRepos(d *sql.DB) ([]RepoSummary, error) {
	rows, err := d.Query(`
		SELECT r.id, r.path, r.name, COALESCE(r.module_name, ''),
		       (SELECT COUNT(*) FROM entities  WHERE repo_id = r.id),
		       (SELECT COUNT(*) FROM relations WHERE repo_id = r.id),
		       r.analyzed_at
		FROM repos r
		ORDER BY r.analyzed_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RepoSummary{}
	for rows.Next() {
		var s RepoSummary
		if err := rows.Scan(&s.ID, &s.Path, &s.Name, &s.ModuleName, &s.EntityCount, &s.RelationCount, &s.AnalyzedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func GetRepo(d *sql.DB, id int64) (*Repo, error) {
	var r Repo
	err := d.QueryRow(`
		SELECT id, path, name, COALESCE(module_name, ''), language, analyzed_at
		FROM repos WHERE id = ?
	`, id).Scan(&r.ID, &r.Path, &r.Name, &r.ModuleName, &r.Language, &r.AnalyzedAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func ListEntities(d *sql.DB, repoID int64) ([]analyzer.Entity, error) {
	rows, err := d.Query(`
		SELECT id, name, kind, file, line, end_line, byte_start, byte_end,
		       source, signature, package, package_dir, doc_comment
		FROM entities WHERE repo_id = ?
		ORDER BY file, line
	`, repoID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []analyzer.Entity{}
	for rows.Next() {
		e, err := scanEntity(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func GetEntity(d *sql.DB, id string) (*analyzer.Entity, error) {
	row := d.QueryRow(`
		SELECT id, name, kind, file, line, end_line, byte_start, byte_end,
		       source, signature, package, package_dir, doc_comment
		FROM entities WHERE id = ?
	`, id)
	e, err := scanEntity(row)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

type rowScanner interface {
	Scan(...any) error
}

func scanEntity(r rowScanner) (analyzer.Entity, error) {
	var e analyzer.Entity
	err := r.Scan(&e.ID, &e.Name, &e.Kind, &e.File, &e.Line, &e.EndLine,
		&e.ByteStart, &e.ByteEnd, &e.Source, &e.Signature, &e.Package, &e.PackageDir, &e.DocComment)
	return e, err
}

// Search ranks entities for a free-text query. Same scoring shape as the old
// Rust impl: exact > prefix > substring on name, then weaker matches on kind,
// package, and signature.
func Search(d *sql.DB, repoID int64, query string) ([]SearchResult, error) {
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return []SearchResult{}, nil
	}
	ents, err := ListEntities(d, repoID)
	if err != nil {
		return nil, err
	}
	out := make([]SearchResult, 0, 32)
	for _, e := range ents {
		name := strings.ToLower(e.Name)
		var score float64
		switch {
		case name == q:
			score = 1.0
		case strings.HasPrefix(name, q):
			score = 0.9
		case strings.Contains(name, q):
			score = 0.7
		case strings.Contains(strings.ToLower(e.Kind), q):
			score = 0.3
		case strings.Contains(strings.ToLower(e.Package), q):
			score = 0.4
		case strings.Contains(strings.ToLower(e.Signature), q):
			score = 0.2
		default:
			continue
		}
		out = append(out, SearchResult{Entity: e, Score: score})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	if len(out) > 50 {
		out = out[:50]
	}
	return out, nil
}

// FocusOf builds the 3-tier focus view for an entity. Tier 1 = same package,
// Tier 2 = same module / different package, Tier 3 = external imports.
func FocusOf(d *sql.DB, entityID string) (*FocusView, error) {
	center, err := GetEntity(d, entityID)
	if err != nil {
		return nil, err
	}

	incoming, err := listIncoming(d, entityID)
	if err != nil {
		return nil, err
	}

	outgoing, err := listOutgoingTargets(d, entityID)
	if err != nil {
		return nil, err
	}

	samePkg := []SamePkgEntry{}
	crossPkg := map[string]*PkgGroup{}
	centerDir := center.PackageDir

	for _, t := range outgoing {
		if t.PackageDir == centerDir {
			samePkg = append(samePkg, SamePkgEntry{
				ID:        t.ID,
				Kind:      t.Kind,
				Signature: t.Signature,
			})
		} else {
			g, ok := crossPkg[t.PackageDir]
			if !ok {
				g = &PkgGroup{
					PkgName: path.Base(t.PackageDir),
					PkgDir:  t.PackageDir,
				}
				crossPkg[t.PackageDir] = g
			}
			switch t.Kind {
			case analyzer.KindFunction, analyzer.KindMethod:
				g.FnCount++
			default:
				g.TypeCount++
			}
		}
	}

	sameModule := make([]PkgGroup, 0, len(crossPkg))
	for _, g := range crossPkg {
		sameModule = append(sameModule, *g)
	}
	sort.SliceStable(sameModule, func(i, j int) bool {
		return (sameModule[i].FnCount + sameModule[i].TypeCount) >
			(sameModule[j].FnCount + sameModule[j].TypeCount)
	})

	external, err := ListExternalDeps(d, entityID)
	if err != nil {
		return nil, err
	}

	return &FocusView{
		Center:       *center,
		Incoming:     incoming,
		SamePkg:      samePkg,
		SameModule:   sameModule,
		ExternalDeps: external,
	}, nil
}

func listIncoming(d *sql.DB, entityID string) ([]Reference, error) {
	rows, err := d.Query(`
		SELECT e.id, e.name, e.kind, e.file, e.line, e.end_line, e.byte_start, e.byte_end,
		       e.source, e.signature, e.package, e.package_dir, e.doc_comment,
		       r.kind
		FROM relations r
		JOIN entities e ON e.id = r.from_id
		WHERE r.to_id = ?
		ORDER BY e.file, e.line
	`, entityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Reference{}
	for rows.Next() {
		var e analyzer.Entity
		var rk string
		if err := rows.Scan(&e.ID, &e.Name, &e.Kind, &e.File, &e.Line, &e.EndLine,
			&e.ByteStart, &e.ByteEnd, &e.Source, &e.Signature, &e.Package, &e.PackageDir, &e.DocComment,
			&rk); err != nil {
			return nil, err
		}
		out = append(out, Reference{Entity: e, Relation: relationLabel(rk)})
	}
	return out, rows.Err()
}

func listOutgoingTargets(d *sql.DB, entityID string) ([]analyzer.Entity, error) {
	rows, err := d.Query(`
		SELECT DISTINCT e.id, e.name, e.kind, e.file, e.line, e.end_line, e.byte_start, e.byte_end,
		       e.source, e.signature, e.package, e.package_dir, e.doc_comment
		FROM relations r
		JOIN entities e ON e.id = r.to_id
		WHERE r.from_id = ?
	`, entityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []analyzer.Entity{}
	for rows.Next() {
		e, err := scanEntity(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func ListExternalDeps(d *sql.DB, entityID string) ([]string, error) {
	rows, err := d.Query(`
		SELECT import_path FROM external_deps WHERE entity_id = ? ORDER BY import_path
	`, entityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

type GraphNode struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	Package    string `json:"package"`
	PackageDir string `json:"package_dir"`
	File       string `json:"file"`
	Line       int    `json:"line"`
}

type GraphEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Kind   string `json:"kind"`
}

type PackageInfo struct {
	Name     string `json:"name"`
	Dir      string `json:"dir"`
	FullPath string `json:"full_path"`
}

type GraphData struct {
	Nodes       []GraphNode   `json:"nodes"`
	Edges       []GraphEdge   `json:"edges"`
	Packages    []string      `json:"packages"`
	PackageInfo []PackageInfo `json:"package_info"`
}

// BuildGraph returns the entity graph for a repo plus synthetic "pkg::<dir>"
// nodes (one per unique package_dir) connected to their member entities via
// Contains edges. The package nodes make d3-force naturally cluster entities
// by package without a custom force.
func BuildGraph(d *sql.DB, repoID int64) (*GraphData, error) {
	repo, err := GetRepo(d, repoID)
	if err != nil {
		return nil, err
	}
	ents, err := ListEntities(d, repoID)
	if err != nil {
		return nil, err
	}

	out := &GraphData{}

	// Entity nodes.
	pkgDirs := map[string]string{} // dir -> name
	for _, e := range ents {
		out.Nodes = append(out.Nodes, GraphNode{
			ID:         e.ID,
			Name:       e.Name,
			Kind:       e.Kind,
			Package:    e.Package,
			PackageDir: e.PackageDir,
			File:       e.File,
			Line:       e.Line,
		})
		if _, seen := pkgDirs[e.PackageDir]; !seen {
			pkgDirs[e.PackageDir] = e.Package
		}
	}

	// Stable, sorted package list.
	dirs := make([]string, 0, len(pkgDirs))
	for dir := range pkgDirs {
		dirs = append(dirs, dir)
	}
	sort.Strings(dirs)

	// Synthetic package nodes + package_info.
	for _, dir := range dirs {
		name := pkgDirs[dir]
		out.Nodes = append(out.Nodes, GraphNode{
			ID:         pkgNodeID(dir),
			Name:       name,
			Kind:       "package",
			Package:    name,
			PackageDir: dir,
		})
		out.Packages = append(out.Packages, name)
		full := dir
		if repo.ModuleName != "" {
			if dir == "." {
				full = repo.ModuleName
			} else {
				full = repo.ModuleName + "/" + dir
			}
		}
		out.PackageInfo = append(out.PackageInfo, PackageInfo{
			Name:     name,
			Dir:      dir,
			FullPath: full,
		})
	}

	// Contains edges: package → entity.
	for _, e := range ents {
		out.Edges = append(out.Edges, GraphEdge{
			Source: pkgNodeID(e.PackageDir),
			Target: e.ID,
			Kind:   "Contains",
		})
	}

	// Relations as edges (filter to known node IDs).
	rows, err := d.Query(`SELECT from_id, to_id, kind FROM relations WHERE repo_id = ?`, repoID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	valid := make(map[string]bool, len(out.Nodes))
	for _, n := range out.Nodes {
		valid[n.ID] = true
	}
	for rows.Next() {
		var e GraphEdge
		if err := rows.Scan(&e.Source, &e.Target, &e.Kind); err != nil {
			return nil, err
		}
		if valid[e.Source] && valid[e.Target] {
			out.Edges = append(out.Edges, e)
		}
	}
	return out, rows.Err()
}

func pkgNodeID(dir string) string { return "pkg::" + dir }

func relationLabel(k string) string {
	switch k {
	case analyzer.RelCalls:
		return "called by"
	case analyzer.RelReferences:
		return "referenced by"
	default:
		return "related to"
	}
}
