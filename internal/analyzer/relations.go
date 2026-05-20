package analyzer

import (
	"go/ast"
	"go/token"
	"go/types"
	"strings"

	"golang.org/x/tools/go/packages"
)

// extractRelationsFile walks each top-level decl in a file, attributes
// identifier references to the enclosing entity, and emits (FromID, ToID,
// Kind) tuples. Calls are distinguished from plain references by checking
// whether an ident sits in a CallExpr.Fun position.
func extractRelationsFile(
	pkg *packages.Package,
	file *ast.File,
	src []byte,
	relPath string,
	defIDs map[types.Object]string,
	modulePath string,
	entityStart map[string]int,
	entityLen map[string]int,
) ([]Relation, map[string][]string, []Ref) {
	var rels []Relation
	var refs []Ref
	deps := make(map[string][]string)
	fset := pkg.Fset

	importMap := buildImportMap(file)

	for _, decl := range file.Decls {
		entityID, ok := topLevelEntityID(decl, src, fset, relPath)
		if !ok {
			continue
		}

		// First mark every ident that is in a CallExpr.Fun position so we can
		// tag those references as Calls.
		callTargets := map[*ast.Ident]bool{}
		ast.Inspect(decl, func(n ast.Node) bool {
			if call, ok := n.(*ast.CallExpr); ok {
				switch f := call.Fun.(type) {
				case *ast.Ident:
					callTargets[f] = true
				case *ast.SelectorExpr:
					callTargets[f.Sel] = true
				}
			}
			return true
		})

		// Then walk and emit a relation for every ident whose Use maps to one
		// of our entities. Skip self-references.
		importsUsed := map[string]bool{}
		ast.Inspect(decl, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.Ident:
				obj := pkg.TypesInfo.Uses[x]
				if obj == nil {
					return true
				}
				tid, ok := defIDs[obj]
				if !ok || tid == entityID {
					return true
				}
				kind := RelReferences
				if callTargets[x] {
					kind = RelCalls
				}
				rels = append(rels, Relation{FromID: entityID, ToID: tid, Kind: kind})

				// Record the identifier's position relative to the enclosing
				// entity's source so the UI can make it a clickable link. Drop
				// out-of-range offsets (multi-spec type/var blocks attribute
				// every spec to the first spec's entity).
				start := fset.Position(x.Pos()).Offset - entityStart[entityID]
				end := fset.Position(x.End()).Offset - entityStart[entityID]
				if start >= 0 && end > start && end <= entityLen[entityID] {
					refs = append(refs, Ref{EntityID: entityID, Start: start, End: end, ToID: tid})
				}
			case *ast.SelectorExpr:
				if ident, ok := x.X.(*ast.Ident); ok {
					if impPath, exists := importMap[ident.Name]; exists {
						importsUsed[impPath] = true
					}
				}
			}
			return true
		})

		for impPath := range importsUsed {
			if isInternalImport(impPath, modulePath) {
				continue
			}
			deps[entityID] = append(deps[entityID], impPath)
		}
	}

	return rels, deps, refs
}

func buildImportMap(file *ast.File) map[string]string {
	out := make(map[string]string, len(file.Imports))
	for _, imp := range file.Imports {
		path := strings.Trim(imp.Path.Value, `"`)
		name := ""
		if imp.Name != nil {
			name = imp.Name.Name
			if name == "_" || name == "." {
				continue
			}
		} else {
			if i := strings.LastIndex(path, "/"); i >= 0 {
				name = path[i+1:]
			} else {
				name = path
			}
		}
		out[name] = path
	}
	return out
}

func topLevelEntityID(decl ast.Decl, src []byte, fset *token.FileSet, relPath string) (string, bool) {
	switch d := decl.(type) {
	case *ast.FuncDecl:
		if d.Name == nil {
			return "", false
		}
		kind := KindFunction
		name := d.Name.Name
		if d.Recv != nil && len(d.Recv.List) > 0 {
			kind = KindMethod
			name = receiverString(d.Recv.List[0].Type, src, fset) + "." + d.Name.Name
		}
		return makeID(relPath, kind, name), true
	case *ast.GenDecl:
		if len(d.Specs) == 0 {
			return "", false
		}
		switch d.Tok {
		case token.TYPE:
			ts, ok := d.Specs[0].(*ast.TypeSpec)
			if !ok || ts.Name == nil {
				return "", false
			}
			kind := KindType
			switch ts.Type.(type) {
			case *ast.StructType:
				kind = KindStruct
			case *ast.InterfaceType:
				kind = KindInterface
			}
			return makeID(relPath, kind, ts.Name.Name), true
		case token.CONST, token.VAR:
			kind := KindConstant
			if d.Tok == token.VAR {
				kind = KindVariable
			}
			vs, ok := d.Specs[0].(*ast.ValueSpec)
			if !ok || len(vs.Names) == 0 {
				return "", false
			}
			return makeID(relPath, kind, vs.Names[0].Name), true
		}
	}
	return "", false
}

func isInternalImport(impPath, modulePath string) bool {
	if modulePath == "" {
		return false
	}
	return impPath == modulePath || strings.HasPrefix(impPath, modulePath+"/")
}
