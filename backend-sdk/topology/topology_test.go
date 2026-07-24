package topology_test

import (
	"reflect"
	"testing"

	"github.com/flowcanvas/flowcanvas-backend-sdk/builtin"
	"github.com/flowcanvas/flowcanvas-backend-sdk/topology"
)

func TestAnalyzeTopology(t *testing.T) {
	result := topology.Analyze(builtin.ExampleGraph())
	want := []string{"text-1", "image-1", "video-1"}
	if !reflect.DeepEqual(result.Order, want) {
		t.Fatalf("order mismatch: got %v want %v", result.Order, want)
	}
	if len(result.CyclicNodeIDs) != 0 {
		t.Fatalf("unexpected cyclic nodes: %v", result.CyclicNodeIDs)
	}
}

func TestWouldCreateCycle(t *testing.T) {
	g := builtin.ExampleGraph()
	if !topology.WouldCreateCycle(g, "video-1", "text-1") {
		t.Fatalf("expected video->text to create cycle")
	}
	if topology.WouldCreateCycle(g, "text-1", "video-1") {
		t.Fatalf("text->video should not create cycle")
	}
}
