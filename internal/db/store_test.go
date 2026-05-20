package db

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/raghavendra-talur/fode/internal/analyzer"
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

// analyzedFixture lays down a minimal module, analyzes it into a temp DB, and
// returns the DB handle plus repo ID.
func analyzedFixture(t *testing.T) (*sql.DB, int64) {
	t.Helper()
	src := t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "go.mod"), []byte("module example.com/fix\n\ngo 1.21\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "main.go"), []byte(fixtureMain), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := analyzer.Analyze(src)
	if err != nil {
		t.Fatalf("Analyze: %v", err)
	}
	d, err := Open(filepath.Join(t.TempDir(), "fode.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	repoID, err := WriteAnalysis(d, res)
	if err != nil {
		t.Fatalf("WriteAnalysis: %v", err)
	}
	return d, repoID
}

func TestDeadCodeClassification(t *testing.T) {
	d, repoID := analyzedFixture(t)

	report, err := DeadCode(d, repoID)
	if err != nil {
		t.Fatalf("DeadCode: %v", err)
	}

	has := func(list []analyzer.Entity, name string) bool {
		for _, e := range list {
			if e.Name == name {
				return true
			}
		}
		return false
	}

	if !has(report.Dead, "unusedFn") {
		t.Errorf("expected unusedFn in dead list, got %+v", report.Dead)
	}
	if !has(report.ExportedUnused, "ExportedUnused") {
		t.Errorf("expected ExportedUnused in exported_unused list, got %+v", report.ExportedUnused)
	}
	// main/init are excluded; helper/used have callers; Polite.Greet is excluded
	// because Polite satisfies Greeter.
	if has(report.Dead, "main") || has(report.ExportedUnused, "main") {
		t.Error("main should be excluded")
	}
	if has(report.Dead, "Polite.Greet") || has(report.ExportedUnused, "Polite.Greet") {
		t.Error("Polite.Greet should be excluded (receiver satisfies an interface)")
	}
	if has(report.Dead, "helper") {
		t.Error("helper has a caller; should not be dead")
	}
}

func TestFocusSplitsRelationGroups(t *testing.T) {
	d, _ := analyzedFixture(t)

	// Greeter is an interface implemented by Polite -> implementations populated.
	fv, err := FocusOf(d, "main.go::interface::Greeter")
	if err != nil {
		t.Fatalf("FocusOf interface: %v", err)
	}
	if len(fv.Implementations) == 0 {
		t.Errorf("expected Greeter to have implementations, got %+v", fv)
	}

	// Polite satisfies Greeter -> satisfies populated.
	pv, err := FocusOf(d, "main.go::struct::Polite")
	if err != nil {
		t.Fatalf("FocusOf struct: %v", err)
	}
	if len(pv.Satisfies) == 0 {
		t.Errorf("expected Polite to satisfy an interface, got %+v", pv)
	}

	// helper is called by used -> callers populated.
	hv, err := FocusOf(d, "main.go::function::helper")
	if err != nil {
		t.Fatalf("FocusOf func: %v", err)
	}
	if len(hv.Callers) == 0 {
		t.Errorf("expected helper to have callers, got %+v", hv)
	}
}
