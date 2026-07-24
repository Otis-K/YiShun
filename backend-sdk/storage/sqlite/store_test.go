package sqlite

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/flowcanvas/flowcanvas-backend-sdk/builtin"
	"github.com/flowcanvas/flowcanvas-backend-sdk/runtime"
)

func TestStoreRecordsRunEventsAndResult(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "flowcanvas.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	engine := builtin.NewDemoEngine()
	engine = runtime.NewEngine(engine.Registry(), runtime.WithRunObserver(store))
	builtin.RegisterExecutors(engine)
	result, err := engine.RunGraph(context.Background(), builtin.ExampleGraph(), runtime.RunOptions{StopOnError: true})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != runtime.StatusSucceeded {
		t.Fatalf("unexpected result status: %s", result.Status)
	}
	runs, err := store.ListRuns(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].RunID != result.RunID || runs[0].Status != runtime.StatusSucceeded {
		t.Fatalf("unexpected stored runs: %+v", runs)
	}
	stored, err := store.GetStoredRun(context.Background(), result.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Graph == nil || stored.Result == nil || stored.Result.Status != runtime.StatusSucceeded {
		t.Fatalf("stored run incomplete: %+v", stored)
	}
	events, err := store.Events(context.Background(), result.RunID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) == 0 || events[len(events)-1].Type != "run.completed" {
		t.Fatalf("events were not persisted correctly: %+v", events)
	}
}
