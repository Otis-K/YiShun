package runtime_test

import (
	"context"
	"testing"
	"time"

	"github.com/flowcanvas/flowcanvas-backend-sdk/builtin"
	"github.com/flowcanvas/flowcanvas-backend-sdk/runtime"
)

func TestRunGraphTextImageVideo(t *testing.T) {
	engine := builtin.NewDemoEngine()
	result, err := engine.RunGraph(context.Background(), builtin.ExampleGraph(), runtime.RunOptions{StopOnError: true})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != runtime.StatusSucceeded {
		t.Fatalf("unexpected run status: %s", result.Status)
	}
	if len(result.Outputs) != 3 {
		t.Fatalf("expected three node outputs, got %d", len(result.Outputs))
	}
	if _, ok := result.Outputs["video-1"]["video"]; !ok {
		t.Fatalf("video output missing: %#v", result.Outputs["video-1"])
	}
}

func TestRunNode(t *testing.T) {
	engine := builtin.NewDemoEngine()
	result, err := engine.RunNode(context.Background(), builtin.ExampleGraph(), "prompt-unknown", nil)
	if err == nil || result != nil {
		t.Fatalf("expected unknown node error")
	}
	result, err = engine.RunNode(context.Background(), builtin.ExampleGraph(), "text-1", nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Output["text"] == "" {
		t.Fatalf("expected text output: %#v", result)
	}
}

func TestCancelRun(t *testing.T) {
	engine := builtin.NewDemoEngine()
	g := builtin.ExampleGraph()
	for i := range g.Nodes {
		g.Nodes[i].Data["delayMs"] = 500
	}
	handle, err := engine.Run(context.Background(), g, runtime.RunOptions{StopOnError: true})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(50 * time.Millisecond)
	handle.Cancel()
	result, err := handle.Wait(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != runtime.StatusCancelled {
		t.Fatalf("expected cancelled, got %s", result.Status)
	}
	_, log, completed := handle.Snapshot()
	if !completed {
		t.Fatalf("handle should be completed")
	}
	found := false
	for _, event := range log {
		if event.Type == "run.cancelled" {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing run.cancelled event in %#v", log)
	}
}
