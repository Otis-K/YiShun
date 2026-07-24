package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/flowcanvas/flowcanvas-backend-sdk/ai"
	"github.com/flowcanvas/flowcanvas-backend-sdk/asset"
	"github.com/flowcanvas/flowcanvas-backend-sdk/builtin"
	aiexec "github.com/flowcanvas/flowcanvas-backend-sdk/executors/ai"
	"github.com/flowcanvas/flowcanvas-backend-sdk/runtime"
	sqlitestore "github.com/flowcanvas/flowcanvas-backend-sdk/storage/sqlite"
)

func main() {
	config := ai.ConfigFromEnv()
	if config.BaseURL == "" {
		config.BaseURL = ai.DefaultBaseURL
	}
	if config.APIKey == "" {
		fmt.Fprintln(os.Stderr, "warning: no AI API key found; requesting provider without Authorization header")
	}
	dataDir := os.Getenv("FLOWCANVAS_DATA_DIR")
	if dataDir == "" {
		dataDir = filepath.Join("tmp", "realchain")
	}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	store, err := sqlitestore.Open(filepath.Join(dataDir, "flowcanvas.db"))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer store.Close()
	assetStore, err := asset.NewFileStore(filepath.Join(dataDir, "assets"), "")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	client, err := ai.NewOpenAIClient(config)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	engine := runtime.NewEngine(builtin.Registry(), runtime.WithRunObserver(store))
	if err := aiexec.RegisterExecutors(engine, aiexec.Config{Client: client, AssetStore: assetStore}); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	maxRetries := 0
	if value := os.Getenv("FLOWCANVAS_RUN_MAX_RETRIES"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed >= 0 {
			maxRetries = parsed
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	result, err := engine.RunGraph(ctx, builtin.ProductionGraph(), runtime.RunOptions{StopOnError: true, MaxRetries: maxRetries})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	events, _ := store.Events(context.Background(), result.RunID, 0)
	summary := map[string]any{
		"ok":          result.Status == runtime.StatusSucceeded,
		"baseURL":     config.BaseURL,
		"model":       config.Model,
		"runId":       result.RunID,
		"status":      result.Status,
		"eventCount":  len(events),
		"error":       result.Error,
		"dataDir":     dataDir,
		"assetDir":    assetStore.RootDir(),
		"nodeStates":  result.NodeStates,
		"outputNodes": result.Outputs,
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(summary)
	if result.Status != runtime.StatusSucceeded {
		os.Exit(1)
	}
}
