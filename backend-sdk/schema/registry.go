package schema

import (
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/flowcanvas/flowcanvas-backend-sdk/graph"
)

type PortDataType string

const (
	DataAny   PortDataType = "any"
	DataText  PortDataType = "text"
	DataImage PortDataType = "image"
	DataVideo PortDataType = "video"
	DataAudio PortDataType = "audio"
	DataJSON  PortDataType = "json"
)

type PortDefinition struct {
	ID       string       `json:"id"`
	Label    string       `json:"label"`
	DataType PortDataType `json:"dataType"`
	Required bool         `json:"required,omitempty"`
	Multiple bool         `json:"multiple,omitempty"`
}

type NodeValidator func(node graph.Node) []graph.ValidationIssue

type NodeDefinition struct {
	Type               string           `json:"type"`
	Title              string           `json:"title"`
	Category           string           `json:"category"`
	Description        string           `json:"description,omitempty"`
	Color              string           `json:"color,omitempty"`
	Icon               string           `json:"icon,omitempty"`
	Inputs             []PortDefinition `json:"inputs"`
	Outputs            []PortDefinition `json:"outputs"`
	RequiredDataFields []string         `json:"requiredDataFields,omitempty"`
	Validate           NodeValidator    `json:"-"`
}

type Registry struct {
	mu          sync.RWMutex
	definitions map[string]NodeDefinition
}

func NewRegistry(definitions ...NodeDefinition) (*Registry, error) {
	r := &Registry{definitions: map[string]NodeDefinition{}}
	for _, definition := range definitions {
		if err := r.Register(definition); err != nil {
			return nil, err
		}
	}
	return r, nil
}

func MustNewRegistry(definitions ...NodeDefinition) *Registry {
	r, err := NewRegistry(definitions...)
	if err != nil {
		panic(err)
	}
	return r
}

func (r *Registry) Register(definition NodeDefinition) error {
	if r == nil {
		return fmt.Errorf("registry is nil")
	}
	definition.Type = strings.TrimSpace(definition.Type)
	if definition.Type == "" {
		return fmt.Errorf("node definition type is required")
	}
	if definition.Title == "" {
		definition.Title = definition.Type
	}
	if definition.Inputs == nil {
		definition.Inputs = []PortDefinition{}
	}
	if definition.Outputs == nil {
		definition.Outputs = []PortDefinition{}
	}
	if err := validatePorts(definition.Inputs, "input", definition.Type); err != nil {
		return err
	}
	if err := validatePorts(definition.Outputs, "output", definition.Type); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.definitions == nil {
		r.definitions = map[string]NodeDefinition{}
	}
	if _, exists := r.definitions[definition.Type]; exists {
		return fmt.Errorf("node definition already registered: %s", definition.Type)
	}
	r.definitions[definition.Type] = definition
	return nil
}

func (r *Registry) MustRegister(definition NodeDefinition) {
	if err := r.Register(definition); err != nil {
		panic(err)
	}
}

func (r *Registry) Get(nodeType string) (NodeDefinition, bool) {
	if r == nil {
		return NodeDefinition{}, false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	definition, ok := r.definitions[nodeType]
	return definition, ok
}

func (r *Registry) Definitions() []NodeDefinition {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]NodeDefinition, 0, len(r.definitions))
	for _, definition := range r.definitions {
		out = append(out, definition)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Type < out[j].Type })
	return out
}

func Compatible(source, target PortDataType) bool {
	return source == DataAny || target == DataAny || source == target
}

func (d NodeDefinition) Input(id string) (PortDefinition, bool) {
	for _, port := range d.Inputs {
		if port.ID == id {
			return port, true
		}
	}
	return PortDefinition{}, false
}

func (d NodeDefinition) Output(id string) (PortDefinition, bool) {
	for _, port := range d.Outputs {
		if port.ID == id {
			return port, true
		}
	}
	return PortDefinition{}, false
}

func validatePorts(ports []PortDefinition, kind, nodeType string) error {
	seen := map[string]struct{}{}
	for _, port := range ports {
		port.ID = strings.TrimSpace(port.ID)
		if port.ID == "" {
			return fmt.Errorf("%s port id is required for node type %s", kind, nodeType)
		}
		if port.DataType == "" {
			return fmt.Errorf("%s port %s dataType is required for node type %s", kind, port.ID, nodeType)
		}
		if _, exists := seen[port.ID]; exists {
			return fmt.Errorf("duplicate %s port %s for node type %s", kind, port.ID, nodeType)
		}
		seen[port.ID] = struct{}{}
	}
	return nil
}
