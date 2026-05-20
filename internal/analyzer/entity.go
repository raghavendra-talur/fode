package analyzer

import (
	"go/ast"
	"go/token"
	"go/types"
	"path"
	"strings"

	"golang.org/x/tools/go/packages"
)

// extractFile walks a single file's top-level declarations and returns the
// entities found. defIDs is populated so the relations pass can map
// types.Object back to entity IDs.
func extractFile(pkg *packages.Package, file *ast.File, src []byte, relPath string, defIDs map[types.Object]string) []Entity {
	out := make([]Entity, 0, len(file.Decls))
	fset := pkg.Fset
	pkgDir := path.Dir(relPath)

	for _, decl := range file.Decls {
		switch d := decl.(type) {
		case *ast.FuncDecl:
			if e, obj := buildFuncEntity(pkg, d, src, relPath, pkgDir, fset); e != nil {
				out = append(out, *e)
				if obj != nil {
					defIDs[obj] = e.ID
				}
			}
		case *ast.GenDecl:
			switch d.Tok {
			case token.TYPE:
				for _, spec := range d.Specs {
					ts, ok := spec.(*ast.TypeSpec)
					if !ok {
						continue
					}
					if e, obj := buildTypeEntity(pkg, d, ts, src, relPath, pkgDir, fset); e != nil {
						out = append(out, *e)
						if obj != nil {
							defIDs[obj] = e.ID
						}
					}
				}
			case token.CONST, token.VAR:
				kind := KindConstant
				if d.Tok == token.VAR {
					kind = KindVariable
				}
				for _, spec := range d.Specs {
					vs, ok := spec.(*ast.ValueSpec)
					if !ok {
						continue
					}
					for _, name := range vs.Names {
						if e, obj := buildValueEntity(pkg, d, name, kind, src, relPath, pkgDir, fset); e != nil {
							out = append(out, *e)
							if obj != nil {
								defIDs[obj] = e.ID
							}
						}
					}
				}
			}
		}
	}
	return out
}

func buildFuncEntity(pkg *packages.Package, d *ast.FuncDecl, src []byte, relPath, pkgDir string, fset *token.FileSet) (*Entity, types.Object) {
	if d.Name == nil {
		return nil, nil
	}
	kind := KindFunction
	name := d.Name.Name
	if d.Recv != nil && len(d.Recv.List) > 0 {
		kind = KindMethod
		name = receiverString(d.Recv.List[0].Type, src, fset) + "." + d.Name.Name
	}
	start, end := fset.Position(d.Pos()), fset.Position(d.End())
	source := sliceBytes(src, start.Offset, end.Offset)
	doc := ""
	if d.Doc != nil {
		doc = d.Doc.Text()
	}
	return &Entity{
		ID:         makeID(relPath, kind, name),
		Name:       name,
		Kind:       kind,
		File:       relPath,
		Line:       start.Line,
		EndLine:    end.Line,
		ByteStart:  start.Offset,
		ByteEnd:    end.Offset,
		Source:     source,
		Signature:  firstLine(source),
		Package:    pkg.Name,
		PackageDir: pkgDir,
		DocComment: strings.TrimSpace(doc),
	}, pkg.TypesInfo.Defs[d.Name]
}

func buildTypeEntity(pkg *packages.Package, d *ast.GenDecl, ts *ast.TypeSpec, src []byte, relPath, pkgDir string, fset *token.FileSet) (*Entity, types.Object) {
	if ts.Name == nil {
		return nil, nil
	}
	kind := KindType
	switch ts.Type.(type) {
	case *ast.StructType:
		kind = KindStruct
	case *ast.InterfaceType:
		kind = KindInterface
	}
	start, end := fset.Position(ts.Pos()), fset.Position(ts.End())
	source := sliceBytes(src, start.Offset, end.Offset)
	doc := ""
	if ts.Doc != nil {
		doc = ts.Doc.Text()
	} else if d.Doc != nil {
		doc = d.Doc.Text()
	}
	return &Entity{
		ID:         makeID(relPath, kind, ts.Name.Name),
		Name:       ts.Name.Name,
		Kind:       kind,
		File:       relPath,
		Line:       start.Line,
		EndLine:    end.Line,
		ByteStart:  start.Offset,
		ByteEnd:    end.Offset,
		Source:     source,
		Signature:  firstLine(source),
		Package:    pkg.Name,
		PackageDir: pkgDir,
		DocComment: strings.TrimSpace(doc),
	}, pkg.TypesInfo.Defs[ts.Name]
}

func buildValueEntity(pkg *packages.Package, d *ast.GenDecl, name *ast.Ident, kind string, src []byte, relPath, pkgDir string, fset *token.FileSet) (*Entity, types.Object) {
	start, end := fset.Position(d.Pos()), fset.Position(d.End())
	source := sliceBytes(src, start.Offset, end.Offset)
	doc := ""
	if d.Doc != nil {
		doc = d.Doc.Text()
	}
	return &Entity{
		ID:         makeID(relPath, kind, name.Name),
		Name:       name.Name,
		Kind:       kind,
		File:       relPath,
		Line:       start.Line,
		EndLine:    end.Line,
		ByteStart:  start.Offset,
		ByteEnd:    end.Offset,
		Source:     source,
		Signature:  firstLine(source),
		Package:    pkg.Name,
		PackageDir: pkgDir,
		DocComment: strings.TrimSpace(doc),
	}, pkg.TypesInfo.Defs[name]
}

func receiverString(t ast.Expr, src []byte, fset *token.FileSet) string {
	switch x := t.(type) {
	case *ast.Ident:
		return x.Name
	case *ast.StarExpr:
		return "*" + receiverString(x.X, src, fset)
	case *ast.IndexExpr:
		return receiverString(x.X, src, fset)
	case *ast.IndexListExpr:
		return receiverString(x.X, src, fset)
	}
	start, end := fset.Position(t.Pos()).Offset, fset.Position(t.End()).Offset
	if s := sliceBytes(src, start, end); s != "" {
		return s
	}
	return "_"
}

func sliceBytes(src []byte, start, end int) string {
	if start < 0 || end > len(src) || start >= end {
		return ""
	}
	return string(src[start:end])
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return strings.TrimRight(s[:i], "\r")
	}
	return s
}
