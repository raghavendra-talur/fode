package cmd

import (
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "fode",
	Short: "fode is an entity-level code editor and reviewer for Go repositories",
	Long: `fode parses a Go repository into an entity graph (functions, methods, types,
interfaces, packages) and persists it in SQLite, so a web UI can navigate,
review, and edit code at the entity level.`,
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}
