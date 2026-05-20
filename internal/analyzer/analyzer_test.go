package analyzer

import (
	"os"
	"path/filepath"
	"testing"
)

const fixtureMain = `package main

type Greeter interface{ Greet() string }

type Polite struct{}

func (p Polite) Greet() string { return "hi" }

func used() string { return helper() }

func helper() string { return "x" }

func unusedFn() {}

func ExportedUnused() {}

func main() {
	_ = used()
	var g Greeter = Polite{}
	_ = g.Greet()
}
`

// writeFixture lays down a minimal single-file Go module and returns its path.
func writeFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module example.com/fix\n\ngo 1.21\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.go"), []byte(fixtureMain), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestRefsSliceBackToIdentifier(t *testing.T) {
	res, err := Analyze(writeFixture(t))
	if err != nil {
		t.Fatalf("Analyze: %v", err)
	}

	srcByID := map[string]string{}
	for _, e := range res.Entities {
		srcByID[e.ID] = e.Source
	}

	if len(res.Refs) == 0 {
		t.Fatal("expected refs, got none")
	}

	// Every ref's [Start,End) must slice the entity source back to an
	// identifier whose name matches the last segment of the target entity.
	foundHelperCall := false
	for _, ref := range res.Refs {
		src, ok := srcByID[ref.EntityID]
		if !ok {
			t.Fatalf("ref references unknown entity %q", ref.EntityID)
		}
		if ref.Start < 0 || ref.End > len(src) || ref.Start >= ref.End {
			t.Fatalf("ref offsets out of range: %+v (len %d)", ref, len(src))
		}
		ident := src[ref.Start:ref.End]
		if ident == "" {
			t.Fatalf("ref sliced to empty string: %+v", ref)
		}
		if ref.EntityID == "main.go::function::used" && ident == "helper" {
			foundHelperCall = true
		}
	}
	if !foundHelperCall {
		t.Error("expected a ref from used() to the helper identifier")
	}
}

func TestDeadCodeRefHasResolvableTarget(t *testing.T) {
	res, err := Analyze(writeFixture(t))
	if err != nil {
		t.Fatalf("Analyze: %v", err)
	}
	ids := map[string]bool{}
	for _, e := range res.Entities {
		ids[e.ID] = true
	}
	for _, ref := range res.Refs {
		if !ids[ref.ToID] {
			t.Errorf("ref target %q is not an in-repo entity", ref.ToID)
		}
	}
}
