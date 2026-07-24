package main

import (
	"flag"
	"log"
	"net/http"
	"path/filepath"

	"github.com/flowcanvas/flowcanvas-backend-sdk/ai"
	"github.com/flowcanvas/flowcanvas-backend-sdk/asset"
	"github.com/flowcanvas/flowcanvas-backend-sdk/builtin"
	aiexec "github.com/flowcanvas/flowcanvas-backend-sdk/executors/ai"
	"github.com/flowcanvas/flowcanvas-backend-sdk/runtime"
	sqlitestore "github.com/flowcanvas/flowcanvas-backend-sdk/storage/sqlite"
	"github.com/flowcanvas/flowcanvas-backend-sdk/transport"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8787", "HTTP listen address")
	mode := flag.String("mode", "demo", "executor mode: demo or ai")
	dataDir := flag.String("data", filepath.Join("tmp", "server"), "data directory for sqlite and assets")
	flag.Parse()

	store, err := sqlitestore.Open(filepath.Join(*dataDir, "flowcanvas.db"))
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()

	engine := runtime.NewEngine(builtin.Registry(), runtime.WithRunObserver(store))
	switch *mode {
	case "ai":
		assetStore, err := asset.NewFileStore(filepath.Join(*dataDir, "assets"), "")
		if err != nil {
			log.Fatal(err)
		}
		client, err := ai.NewOpenAIClient(ai.ConfigFromEnv())
		if err != nil {
			log.Fatal(err)
		}
		if err := aiexec.RegisterExecutors(engine, aiexec.Config{Client: client, AssetStore: assetStore}); err != nil {
			log.Fatal(err)
		}
		log.Printf("Executor mode: ai baseURL=%s model=%s assetDir=%s", client.Config().BaseURL, client.Config().Model, assetStore.RootDir())
	case "demo":
		builtin.RegisterExecutors(engine)
		log.Printf("Executor mode: demo")
	default:
		log.Fatalf("unsupported mode %q; use demo or ai", *mode)
	}
	server := transport.NewServerWithArchive(engine, store)

	log.Printf("FlowCanvas Backend SDK example server listening on http://%s", *addr)
	log.Printf("Health:   GET  http://%s/api/flow/health", *addr)
	log.Printf("Validate: POST http://%s/api/flow/validate", *addr)
	log.Printf("Run:      POST http://%s/api/flow/run", *addr)
	log.Printf("Runs:     GET  http://%s/api/flow/runs", *addr)
	if err := http.ListenAndServe(*addr, server.Handler()); err != nil {
		log.Fatal(err)
	}
}
