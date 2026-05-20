package cmd

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"github.com/raghavendra-talur/fode/internal/db"
	"github.com/raghavendra-talur/fode/internal/server"
	"github.com/spf13/cobra"
)

var (
	servePort int
	serveDB   string
)

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Run the HTTP API server backing the fode web UI",
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := os.MkdirAll(filepath.Dir(serveDB), 0o755); err != nil {
			return err
		}
		database, err := db.Open(serveDB)
		if err != nil {
			return err
		}
		defer database.Close()

		srv := server.New(database)
		addr := fmt.Sprintf(":%d", servePort)
		fmt.Printf("fode: listening on %s (db=%s)\n", addr, serveDB)
		return http.ListenAndServe(addr, srv.Handler())
	},
}

func init() {
	serveCmd.Flags().IntVar(&servePort, "port", 9100, "port to listen on")
	serveCmd.Flags().StringVar(&serveDB, "db", ".fode/fode.db", "path to the SQLite database")
	rootCmd.AddCommand(serveCmd)
}
