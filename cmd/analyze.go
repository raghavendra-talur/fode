package cmd

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/raghavendra-talur/fode/internal/analyzer"
	"github.com/raghavendra-talur/fode/internal/db"
	"github.com/spf13/cobra"
)

var analyzeDB string

var analyzeCmd = &cobra.Command{
	Use:   "analyze [path]",
	Short: "Analyze a Go repository and write its entity graph to the database",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		path := args[0]
		fmt.Fprintf(os.Stderr, "fode: analyzing %s\n", path)
		result, err := analyzer.Analyze(path)
		if err != nil {
			return err
		}
		fmt.Fprintf(os.Stderr, "fode: extracted %d entities, %d relations\n",
			len(result.Entities), len(result.Relations))

		if err := os.MkdirAll(filepath.Dir(analyzeDB), 0o755); err != nil {
			return err
		}
		database, err := db.Open(analyzeDB)
		if err != nil {
			return err
		}
		defer database.Close()

		repoID, err := db.WriteAnalysis(database, result)
		if err != nil {
			return err
		}
		fmt.Fprintf(os.Stderr, "fode: wrote repo id=%d to %s\n", repoID, analyzeDB)
		return nil
	},
}

func init() {
	analyzeCmd.Flags().StringVar(&analyzeDB, "db", ".fode/fode.db", "path to the SQLite database")
	rootCmd.AddCommand(analyzeCmd)
}
