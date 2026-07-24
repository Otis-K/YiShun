package graph_test

import (
	"encoding/json"
	"testing"

	"github.com/flowcanvas/flowcanvas-backend-sdk/builtin"
	"github.com/flowcanvas/flowcanvas-backend-sdk/graph"
)

func TestParseAndMarshalFrontendGraphJSON(t *testing.T) {
	source, err := graph.MarshalDocument(builtin.ExampleGraph())
	if err != nil {
		t.Fatal(err)
	}
	doc, err := graph.ParseDocument(source)
	if err != nil {
		t.Fatal(err)
	}
	if doc.SchemaVersion != graph.CurrentSchemaVersion {
		t.Fatalf("schema version mismatch: %d", doc.SchemaVersion)
	}
	if len(doc.Nodes) != 3 || len(doc.Edges) != 3 {
		t.Fatalf("unexpected graph shape: nodes=%d edges=%d", len(doc.Nodes), len(doc.Edges))
	}
	roundTrip, err := graph.MarshalDocument(doc)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(roundTrip, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["schemaVersion"].(float64) != 1 {
		t.Fatalf("roundtrip schema version not preserved: %v", decoded["schemaVersion"])
	}
}

func TestNormalizeDefaults(t *testing.T) {
	doc := &graph.GraphDocument{ID: "x", Name: "x"}
	doc.Normalize()
	if doc.SchemaVersion != 1 || doc.Viewport.Zoom != 1 {
		t.Fatalf("normalization failed: %#v", doc)
	}
	if doc.Nodes == nil || doc.Edges == nil || doc.Metadata == nil {
		t.Fatalf("normalization should initialize slices/maps: %#v", doc)
	}
}
