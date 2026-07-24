package graph

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
)

const CurrentSchemaVersion = 1

type NodeID = string
type EdgeID = string

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type ViewportState struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Zoom float64 `json:"zoom"`
}

type NodeData map[string]any

type Node struct {
	ID       NodeID   `json:"id"`
	Type     string   `json:"type"`
	Position Point    `json:"position"`
	Data     NodeData `json:"data"`
	Width    *float64 `json:"width,omitempty"`
	Height   *float64 `json:"height,omitempty"`
	ParentID *NodeID  `json:"parentId,omitempty"`
	Locked   *bool    `json:"locked,omitempty"`
}

type Edge struct {
	ID         EdgeID         `json:"id"`
	Source     NodeID         `json:"source"`
	SourcePort string         `json:"sourcePort"`
	Target     NodeID         `json:"target"`
	TargetPort string         `json:"targetPort"`
	Label      string         `json:"label,omitempty"`
	Data       map[string]any `json:"data,omitempty"`
}

type GraphDocument struct {
	SchemaVersion int            `json:"schemaVersion"`
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	Nodes         []Node         `json:"nodes"`
	Edges         []Edge         `json:"edges"`
	Viewport      ViewportState  `json:"viewport"`
	Metadata      map[string]any `json:"metadata"`
}

type ValidationSeverity string

const (
	SeverityError   ValidationSeverity = "error"
	SeverityWarning ValidationSeverity = "warning"
)

type ValidationIssue struct {
	Code     string             `json:"code"`
	Severity ValidationSeverity `json:"severity"`
	Message  string             `json:"message"`
	NodeID   NodeID             `json:"nodeId,omitempty"`
	EdgeID   EdgeID             `json:"edgeId,omitempty"`
	PortID   string             `json:"portId,omitempty"`
	Details  map[string]any     `json:"details,omitempty"`
}

type ValidationResult struct {
	Valid  bool              `json:"valid"`
	Issues []ValidationIssue `json:"issues"`
}

func ParseDocument(data []byte) (*GraphDocument, error) {
	if len(bytes.TrimSpace(data)) == 0 {
		return nil, errors.New("graph JSON is empty")
	}
	var doc GraphDocument
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("parse graph JSON: %w", err)
	}
	doc.Normalize()
	return &doc, nil
}

func MustParseDocument(data []byte) *GraphDocument {
	doc, err := ParseDocument(data)
	if err != nil {
		panic(err)
	}
	return doc
}

func MarshalDocument(doc *GraphDocument) ([]byte, error) {
	if doc == nil {
		return nil, errors.New("graph document is nil")
	}
	clone := doc.Clone()
	clone.Normalize()
	return json.MarshalIndent(clone, "", "  ")
}

func (g *GraphDocument) Normalize() {
	if g.SchemaVersion == 0 {
		g.SchemaVersion = CurrentSchemaVersion
	}
	if g.Nodes == nil {
		g.Nodes = []Node{}
	}
	if g.Edges == nil {
		g.Edges = []Edge{}
	}
	if g.Metadata == nil {
		g.Metadata = map[string]any{}
	}
	if g.Viewport.Zoom == 0 {
		g.Viewport.Zoom = 1
	}
	for i := range g.Nodes {
		if g.Nodes[i].Data == nil {
			g.Nodes[i].Data = NodeData{}
		}
	}
}

func (g *GraphDocument) Clone() *GraphDocument {
	if g == nil {
		return nil
	}
	data, err := json.Marshal(g)
	if err != nil {
		panic(err)
	}
	var out GraphDocument
	if err := json.Unmarshal(data, &out); err != nil {
		panic(err)
	}
	out.Normalize()
	return &out
}

func EmptyDocument(id, name string) *GraphDocument {
	return &GraphDocument{
		SchemaVersion: CurrentSchemaVersion,
		ID:            id,
		Name:          name,
		Nodes:         []Node{},
		Edges:         []Edge{},
		Viewport:      ViewportState{Zoom: 1},
		Metadata:      map[string]any{},
	}
}

func DataString(data map[string]any, key string) string {
	if data == nil {
		return ""
	}
	switch value := data[key].(type) {
	case string:
		return value
	case fmt.Stringer:
		return value.String()
	default:
		if value == nil {
			return ""
		}
		return fmt.Sprint(value)
	}
}

func DataFloat(data map[string]any, key string, fallback float64) float64 {
	if data == nil {
		return fallback
	}
	switch value := data[key].(type) {
	case float64:
		return value
	case float32:
		return float64(value)
	case int:
		return float64(value)
	case int64:
		return float64(value)
	case json.Number:
		n, err := value.Float64()
		if err == nil {
			return n
		}
	}
	return fallback
}
