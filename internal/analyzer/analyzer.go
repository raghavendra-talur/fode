// Package analyzer loads a Go module via golang.org/x/tools/go/packages and
// extracts an entity graph (functions, methods, types, interfaces, consts,
// vars) plus the relations between them. Reference resolution rides on
// pkg.TypesInfo.Uses, so cross-package + interface + generic references are
// handled by the type checker rather than by us.
package analyzer

import (
	"fmt"
	"go/types"
	"os"
	"path/filepath"
	"sort"

	"golang.org/x/tools/go/packages"
)

// Entity kinds. Kept in sync with the `kind` column in schema.sql.
const (
	KindFunction  = "function"
	KindMethod    = "method"
	KindStruct    = "struct"
	KindInterface = "interface"
	KindType      = "type"
	KindConstant  = "const"
	KindVariable  = "var"
)

// Relation kinds.
const (
	RelCalls      = "Calls"
	RelReferences = "References"
)

type Entity struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	File       string `json:"file"`
	Line       int    `json:"line"`
	EndLine    int    `json:"end_line"`
	ByteStart  int    `json:"byte_start"`
	ByteEnd    int    `json:"byte_end"`
	Source     string `json:"source"`
	Signature  string `json:"signature"`
	Package    string `json:"package"`
	PackageDir string `json:"package_dir"`
	DocComment string `json:"doc_comment"`
}

type Relation struct {
	FromID string `json:"from_id"`
	ToID   string `json:"to_id"`
	Kind   string `json:"kind"`
}

type RepoInfo struct {
	Path       string `json:"path"`
	Name       string `json:"name"`
	ModuleName string `json:"module_name"`
}

type Result struct {
	Repo         RepoInfo
	Entities     []Entity
	Relations    []Relation
	ExternalDeps map[string][]string // entity_id -> import paths
}

// Analyze loads the Go module rooted at repoPath and returns its entity graph.
func Analyze(repoPath string) (*Result, error) {
	absPath, err := filepath.Abs(repoPath)
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(absPath); err != nil {
		return nil, fmt.Errorf("repo path: %w", err)
	}

	cfg := &packages.Config{
		Mode: packages.NeedName | packages.NeedFiles | packages.NeedImports |
			packages.NeedDeps | packages.NeedTypes | packages.NeedSyntax |
			packages.NeedTypesInfo | packages.NeedModule,
		Dir:   absPath,
		Tests: false,
	}
	pkgs, err := packages.Load(cfg, "./...")
	if err != nil {
		return nil, fmt.Errorf("packages.Load: %w", err)
	}
	if len(pkgs) == 0 {
		return nil, fmt.Errorf("no packages found at %s", absPath)
	}

	moduleName := ""
	for _, p := range pkgs {
		if p.Module != nil && p.Module.Path != "" {
			moduleName = p.Module.Path
			break
		}
	}
	if moduleName == "" {
		return nil, fmt.Errorf("no go module detected; is %s a Go module?", absPath)
	}

	result := &Result{
		Repo: RepoInfo{
			Path:       absPath,
			Name:       filepath.Base(absPath),
			ModuleName: moduleName,
		},
		ExternalDeps: make(map[string][]string),
	}

	// First pass: extract entities and build a (types.Object -> entity ID) map
	// that the second pass uses to resolve identifier uses into relations.
	defIDs := make(map[types.Object]string)
	seenIDs := make(map[string]bool)

	for _, pkg := range pkgs {
		if !isOwn(pkg, moduleName) {
			continue
		}
		for i, file := range pkg.Syntax {
			if i >= len(pkg.GoFiles) {
				continue
			}
			rel, src, ok := readFile(absPath, pkg.GoFiles[i])
			if !ok {
				continue
			}
			for _, e := range extractFile(pkg, file, src, rel, defIDs) {
				if !seenIDs[e.ID] {
					seenIDs[e.ID] = true
					result.Entities = append(result.Entities, e)
				}
			}
		}
	}

	// Second pass: relations + external deps.
	type relKey struct{ from, to, kind string }
	relSeen := make(map[relKey]bool)
	for _, pkg := range pkgs {
		if !isOwn(pkg, moduleName) {
			continue
		}
		for i, file := range pkg.Syntax {
			if i >= len(pkg.GoFiles) {
				continue
			}
			rel, src, ok := readFile(absPath, pkg.GoFiles[i])
			if !ok {
				continue
			}
			rels, deps := extractRelationsFile(pkg, file, src, rel, defIDs, moduleName)
			for _, r := range rels {
				k := relKey{r.FromID, r.ToID, r.Kind}
				if relSeen[k] {
					continue
				}
				relSeen[k] = true
				result.Relations = append(result.Relations, r)
			}
			for eid, paths := range deps {
				result.ExternalDeps[eid] = append(result.ExternalDeps[eid], paths...)
			}
		}
	}

	// Third pass: interface satisfaction. types.Implements does the heavy
	// lifting; we just iterate (interface, candidate) pairs from the entity
	// universe we've already extracted.
	for _, r := range findInterfaceImpls(result.Entities, defIDs) {
		k := relKey{r.FromID, r.ToID, r.Kind}
		if relSeen[k] {
			continue
		}
		relSeen[k] = true
		result.Relations = append(result.Relations, r)
	}

	// Dedupe + sort external_deps for stable output.
	for eid, paths := range result.ExternalDeps {
		sort.Strings(paths)
		paths = dedupeSorted(paths)
		result.ExternalDeps[eid] = paths
	}

	return result, nil
}

func isOwn(pkg *packages.Package, moduleName string) bool {
	if pkg.Module == nil {
		return false
	}
	return pkg.Module.Path == moduleName
}

func readFile(repoAbs, fileAbs string) (rel string, src []byte, ok bool) {
	rel, err := filepath.Rel(repoAbs, fileAbs)
	if err != nil {
		return "", nil, false
	}
	rel = filepath.ToSlash(rel)
	src, err = os.ReadFile(fileAbs)
	if err != nil {
		return "", nil, false
	}
	return rel, src, true
}

func dedupeSorted(in []string) []string {
	if len(in) < 2 {
		return in
	}
	out := in[:1]
	for _, s := range in[1:] {
		if s != out[len(out)-1] {
			out = append(out, s)
		}
	}
	return out
}

func makeID(file, kind, name string) string {
	return fmt.Sprintf("%s::%s::%s", file, kind, name)
}
