package validator_test

import (
	"testing"

	"github.com/flowcanvas/flowcanvas-backend-sdk/builtin"
	"github.com/flowcanvas/flowcanvas-backend-sdk/graph"
	"github.com/flowcanvas/flowcanvas-backend-sdk/validator"
)

func TestValidateGoodGraph(t *testing.T) {
	result := validator.Validate(builtin.ExampleGraph(), builtin.Registry())
	if !result.Valid {
		t.Fatalf("expected graph to be valid: %+v", result.Issues)
	}
}

func TestValidateBrokenGraphs(t *testing.T) {
	cases := []struct {
		name string
		code string
	}{
		{"missing-port", validator.MissingSourcePort},
		{"cycle", validator.CycleDetected},
		{"missing-prompt", validator.NodeConfigurationInvalid},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result := validator.Validate(builtin.BrokenGraph(tc.name), builtin.Registry())
			if result.Valid {
				t.Fatalf("expected invalid graph")
			}
			for _, issue := range result.Issues {
				if issue.Code == tc.code {
					return
				}
			}
			t.Fatalf("missing issue %s in %+v", tc.code, result.Issues)
		})
	}
}

func TestRequiredInputForCompose(t *testing.T) {
	g := builtin.ExampleGraph()
	g.Nodes = append(g.Nodes, builtin.BrokenGraph("missing-prompt").Nodes[0])
	g.Nodes[len(g.Nodes)-1].ID = "compose-1"
	g.Nodes[len(g.Nodes)-1].Type = "compose"
	g.Nodes[len(g.Nodes)-1].Data = graph.NodeData{"title": "compose"}
	result := validator.Validate(g, builtin.Registry())
	if result.Valid {
		t.Fatalf("expected missing compose video input")
	}
	for _, issue := range result.Issues {
		if issue.Code == validator.RequiredInputMissing {
			return
		}
	}
	t.Fatalf("missing required input issue: %+v", result.Issues)
}
