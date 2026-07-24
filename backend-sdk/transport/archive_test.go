package transport

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/flowcanvas/flowcanvas-backend-sdk/builtin"
	"github.com/flowcanvas/flowcanvas-backend-sdk/runtime"
	sqlitestore "github.com/flowcanvas/flowcanvas-backend-sdk/storage/sqlite"
)

func TestServerExposesPersistedRuns(t *testing.T) {
	store, err := sqlitestore.Open(filepath.Join(t.TempDir(), "flowcanvas.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	engine := runtime.NewEngine(builtin.Registry(), runtime.WithRunObserver(store))
	builtin.RegisterExecutors(engine)
	result, err := engine.RunGraph(context.Background(), builtin.ExampleGraph(), runtime.RunOptions{StopOnError: true})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServerWithArchive(engine, store).Handler())
	defer server.Close()
	resp, err := http.Get(server.URL + "/api/flow/runs?limit=5")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var listed struct {
		Runs []runtime.RunSummary `json:"runs"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Runs) != 1 || listed.Runs[0].RunID != result.RunID {
		t.Fatalf("unexpected listed runs: %+v", listed.Runs)
	}
}
