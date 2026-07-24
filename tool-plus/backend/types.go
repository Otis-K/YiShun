package main

type Request struct {
	Tool       string            `json:"tool"`
	Inputs     []string          `json:"inputs"`
	OutputDir  string            `json:"outputDir"`
	Options    map[string]string `json:"options"`
	WorkflowID string            `json:"workflowId,omitempty"`
	RunID      string            `json:"runId,omitempty"`
	StepID     string            `json:"stepId,omitempty"`
	Attempt    int               `json:"attempt,omitempty"`
}

type ParamDef struct {
	Name    string   `json:"name"`
	Label   string   `json:"label"`
	Type    string   `json:"type,omitempty"`
	Value   any      `json:"value,omitempty"`
	Min     string   `json:"min,omitempty"`
	Max     string   `json:"max,omitempty"`
	Step    string   `json:"step,omitempty"`
	Choices []string `json:"choices,omitempty"`
}

type Tool struct {
	Key                       string           `json:"key"`
	Title                     string           `json:"title"`
	Category                  string           `json:"category"`
	Description               string           `json:"description"`
	InputKind                 string           `json:"inputKind"`
	Params                    []ParamDef       `json:"params"`
	Maturity                  string           `json:"maturity"`
	Limits                    map[string]any   `json:"limits"`
	TimeoutSeconds            int              `json:"timeoutSeconds"`
	PerformanceBudget         map[string]any   `json:"performanceBudget"`
	UIReferenceID             string           `json:"uiReferenceId"`
	AcceptanceCaseIDs         []string         `json:"acceptanceCaseIds"`
	ExecutionMode             string           `json:"executionMode"`
	AcceptedExtensions        []string         `json:"acceptedExtensions"`
	InputContract             map[string]any   `json:"inputContract"`
	OutputContract            map[string]any   `json:"outputContract"`
	WorkflowCapable           bool             `json:"workflowCapable"`
	WorkflowUnavailableReason string           `json:"workflowUnavailableReason,omitempty"`
	Destructive               bool             `json:"destructive"`
	Cardinality               string           `json:"cardinality"`
	EntitlementKey            string           `json:"entitlementKey"`
	RequiredPlan              string           `json:"requiredPlan"`
	Wizard                    map[string]any   `json:"wizard"`
	UISchema                  map[string]any   `json:"uiSchema"`
	OutputProfile             string           `json:"outputProfile"`
	OutputFields              []map[string]any `json:"outputFields"`
}

type Response struct {
	OK      bool     `json:"ok"`
	Outputs []string `json:"outputs,omitempty"`
	Error   string   `json:"error,omitempty"`
}

type ResponseCatalog struct {
	OK    bool   `json:"ok"`
	Tools []Tool `json:"tools"`
}
