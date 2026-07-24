package runtime

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/flowcanvas/flowcanvas-backend-sdk/events"
	"github.com/flowcanvas/flowcanvas-backend-sdk/graph"
	"github.com/flowcanvas/flowcanvas-backend-sdk/schema"
	"github.com/flowcanvas/flowcanvas-backend-sdk/topology"
	"github.com/flowcanvas/flowcanvas-backend-sdk/validator"
)

const (
	StatusQueued    = "queued"
	StatusRunning   = "running"
	StatusSucceeded = "succeeded"
	StatusFailed    = "failed"
	StatusCancelled = "cancelled"
)

type ProgressFunc func(progress float64, message string)

type NodeInput struct {
	RunID   string
	Node    graph.Node
	Inputs  map[string]any
	Attempt int
}

type Executor interface {
	Execute(ctx context.Context, input NodeInput, emit ProgressFunc) (map[string]any, error)
}

type ExecutorFunc func(ctx context.Context, input NodeInput, emit ProgressFunc) (map[string]any, error)

func (f ExecutorFunc) Execute(ctx context.Context, input NodeInput, emit ProgressFunc) (map[string]any, error) {
	return f(ctx, input, emit)
}

type RunOptions struct {
	RunID       string `json:"runId,omitempty"`
	StopOnError bool   `json:"stopOnError"`
	MaxRetries  int    `json:"maxRetries"`
}

type RunRecord struct {
	RunID     string               `json:"runId"`
	GraphID   string               `json:"graphId,omitempty"`
	GraphName string               `json:"graphName,omitempty"`
	Status    string               `json:"status"`
	Graph     *graph.GraphDocument `json:"graph,omitempty"`
	CreatedAt time.Time            `json:"createdAt"`
}

type RunObserver interface {
	OnRunCreated(record RunRecord) error
	OnRunEvent(event events.Event) error
	OnRunFinished(result *RunResult) error
}

type EngineOption func(*Engine)

func WithRunObserver(observer RunObserver) EngineOption {
	return func(e *Engine) {
		e.observer = observer
	}
}

type NodeState struct {
	NodeID    string    `json:"nodeId"`
	NodeType  string    `json:"nodeType"`
	Status    string    `json:"status"`
	Progress  float64   `json:"progress"`
	Message   string    `json:"message,omitempty"`
	Error     string    `json:"error,omitempty"`
	StartedAt time.Time `json:"startedAt,omitempty"`
	EndedAt   time.Time `json:"endedAt,omitempty"`
	Attempts  int       `json:"attempts"`
}

type RunResult struct {
	RunID      string                    `json:"runId"`
	Status     string                    `json:"status"`
	NodeStates map[string]NodeState      `json:"nodeStates"`
	Outputs    map[string]map[string]any `json:"outputs"`
	StartedAt  time.Time                 `json:"startedAt"`
	EndedAt    time.Time                 `json:"endedAt"`
	Error      string                    `json:"error,omitempty"`
}

type RunSummary struct {
	RunID     string     `json:"runId"`
	GraphID   string     `json:"graphId,omitempty"`
	GraphName string     `json:"graphName,omitempty"`
	Status    string     `json:"status"`
	Error     string     `json:"error,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
	StartedAt *time.Time `json:"startedAt,omitempty"`
	EndedAt   *time.Time `json:"endedAt,omitempty"`
	UpdatedAt time.Time  `json:"updatedAt"`
}

type StoredRun struct {
	RunSummary
	Graph  *graph.GraphDocument `json:"graph,omitempty"`
	Result *RunResult           `json:"result,omitempty"`
}

type NodeResult struct {
	NodeID string         `json:"nodeId"`
	Output map[string]any `json:"output"`
}

type Engine struct {
	registry  *schema.Registry
	executors map[string]Executor
	observer  RunObserver
	mu        sync.RWMutex
	runs      map[string]*RunHandle
}

func NewEngine(registry *schema.Registry, options ...EngineOption) *Engine {
	if registry == nil {
		registry = schema.MustNewRegistry()
	}
	engine := &Engine{
		registry:  registry,
		executors: map[string]Executor{},
		runs:      map[string]*RunHandle{},
	}
	for _, option := range options {
		if option != nil {
			option(engine)
		}
	}
	return engine
}

func (e *Engine) Registry() *schema.Registry {
	return e.registry
}

func (e *Engine) RegisterExecutor(nodeType string, executor Executor) {
	if e == nil {
		panic("runtime engine is nil")
	}
	if executor == nil {
		panic("executor is nil")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.executors[nodeType] = executor
}

func (e *Engine) Run(ctx context.Context, doc *graph.GraphDocument, options RunOptions) (*RunHandle, error) {
	if e == nil {
		return nil, errors.New("runtime engine is nil")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if doc == nil {
		return nil, errors.New("graph document is nil")
	}
	doc = doc.Clone()
	result := validator.Validate(doc, e.registry)
	if !result.Valid {
		return nil, validator.GraphValidationError{Result: result}
	}
	runID := options.RunID
	if runID == "" {
		runID = newRunID()
	}
	runCtx, cancel := context.WithCancel(ctx)
	handle := newRunHandle(runID, cancel, e.observer)
	if e.observer != nil {
		if err := e.observer.OnRunCreated(RunRecord{
			RunID:     runID,
			GraphID:   doc.ID,
			GraphName: doc.Name,
			Status:    StatusQueued,
			Graph:     doc.Clone(),
			CreatedAt: time.Now().UTC(),
		}); err != nil {
			cancel()
			return nil, fmt.Errorf("record run %s: %w", runID, err)
		}
	}
	e.mu.Lock()
	e.runs[runID] = handle
	e.mu.Unlock()
	go e.execute(runCtx, handle, doc, options)
	return handle, nil
}

func (e *Engine) RunGraph(ctx context.Context, doc *graph.GraphDocument, options RunOptions) (*RunResult, error) {
	handle, err := e.Run(ctx, doc, options)
	if err != nil {
		return nil, err
	}
	return handle.Wait(ctx)
}

func (e *Engine) RunNode(ctx context.Context, doc *graph.GraphDocument, nodeID string, inputs map[string]any) (*NodeResult, error) {
	if doc == nil {
		return nil, errors.New("graph document is nil")
	}
	doc = doc.Clone()
	result := validator.Validate(doc, e.registry)
	if !result.Valid {
		return nil, validator.GraphValidationError{Result: result}
	}
	node, ok := findNode(doc, nodeID)
	if !ok {
		return nil, fmt.Errorf("node not found: %s", nodeID)
	}
	executor, ok := e.executor(node.Type)
	if !ok {
		return nil, fmt.Errorf("executor not registered for node type: %s", node.Type)
	}
	output, err := executor.Execute(ctx, NodeInput{
		RunID:   "single-node",
		Node:    node,
		Inputs:  cloneMap(inputs),
		Attempt: 1,
	}, func(float64, string) {})
	if err != nil {
		return nil, err
	}
	return &NodeResult{NodeID: nodeID, Output: output}, nil
}

func (e *Engine) GetRun(runID string) (*RunHandle, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	handle, ok := e.runs[runID]
	return handle, ok
}

func (e *Engine) CancelRun(runID string) error {
	handle, ok := e.GetRun(runID)
	if !ok {
		return fmt.Errorf("run not found: %s", runID)
	}
	handle.Cancel()
	return nil
}

func (e *Engine) executor(nodeType string) (Executor, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	executor, ok := e.executors[nodeType]
	return executor, ok
}

func (e *Engine) execute(ctx context.Context, handle *RunHandle, doc *graph.GraphDocument, options RunOptions) {
	started := time.Now().UTC()
	result := &RunResult{
		RunID:      handle.RunID(),
		Status:     StatusRunning,
		NodeStates: map[string]NodeState{},
		Outputs:    map[string]map[string]any{},
		StartedAt:  started,
	}
	for _, node := range doc.Nodes {
		state := NodeState{NodeID: node.ID, NodeType: node.Type, Status: StatusQueued, Attempts: 0}
		result.NodeStates[node.ID] = state
		handle.emit(events.Event{Type: events.NodeQueued, RunID: handle.RunID(), NodeID: node.ID, NodeType: node.Type, Status: StatusQueued})
	}
	handle.emit(events.Event{Type: events.RunStarted, RunID: handle.RunID(), Status: StatusRunning, Message: "工作流开始执行"})

	topo := topology.Analyze(doc)
	for _, nodeID := range topo.Order {
		if ctx.Err() != nil {
			e.cancelRemaining(handle, result, doc, nodeID)
			return
		}
		node, ok := findNode(doc, nodeID)
		if !ok {
			continue
		}
		inputs := gatherInputs(doc, node.ID, result.Outputs, e.registry)
		state := result.NodeStates[node.ID]
		state.Status = StatusRunning
		state.Progress = 0
		state.StartedAt = time.Now().UTC()
		result.NodeStates[node.ID] = state
		handle.emit(events.Event{Type: events.NodeRunning, RunID: handle.RunID(), NodeID: node.ID, NodeType: node.Type, Status: StatusRunning, Progress: 0, Message: "开始执行"})

		output, err := e.executeNodeWithRetry(ctx, handle, node, inputs, options, result)
		if err != nil {
			state = result.NodeStates[node.ID]
			state.Status = statusFromError(err)
			state.Error = err.Error()
			state.EndedAt = time.Now().UTC()
			if state.Status == StatusCancelled {
				state.Progress = 0
				result.NodeStates[node.ID] = state
				handle.emit(events.Event{Type: events.NodeCancelled, RunID: handle.RunID(), NodeID: node.ID, NodeType: node.Type, Status: StatusCancelled, Error: err.Error()})
				e.cancelRemaining(handle, result, doc, node.ID)
				return
			}
			result.NodeStates[node.ID] = state
			handle.emit(events.Event{Type: events.NodeFailed, RunID: handle.RunID(), NodeID: node.ID, NodeType: node.Type, Status: StatusFailed, Error: err.Error()})
			if options.StopOnError || !hasExplicitStopOnError(options) {
				result.Status = StatusFailed
				result.Error = err.Error()
				result.EndedAt = time.Now().UTC()
				handle.emit(events.Event{Type: events.RunFailed, RunID: handle.RunID(), Status: StatusFailed, Error: err.Error()})
				handle.finish(result)
				return
			}
			continue
		}
		if output == nil {
			output = map[string]any{}
		}
		result.Outputs[node.ID] = output
		state = result.NodeStates[node.ID]
		state.Status = StatusSucceeded
		state.Progress = 1
		state.EndedAt = time.Now().UTC()
		result.NodeStates[node.ID] = state
		handle.emit(events.Event{Type: events.NodeSucceeded, RunID: handle.RunID(), NodeID: node.ID, NodeType: node.Type, Status: StatusSucceeded, Progress: 1, Message: "执行成功", Output: output})
	}
	result.Status = StatusSucceeded
	result.EndedAt = time.Now().UTC()
	handle.emit(events.Event{Type: events.RunCompleted, RunID: handle.RunID(), Status: StatusSucceeded, Message: "工作流执行完成"})
	handle.finish(result)
}

func (e *Engine) executeNodeWithRetry(ctx context.Context, handle *RunHandle, node graph.Node, inputs map[string]any, options RunOptions, result *RunResult) (map[string]any, error) {
	executor, ok := e.executor(node.Type)
	if !ok {
		return nil, fmt.Errorf("executor not registered for node type: %s", node.Type)
	}
	maxRetries := options.MaxRetries
	if maxRetries < 0 {
		maxRetries = 0
	}
	var lastErr error
	for attempt := 1; attempt <= maxRetries+1; attempt++ {
		state := result.NodeStates[node.ID]
		state.Attempts = attempt
		result.NodeStates[node.ID] = state
		output, err := executor.Execute(ctx, NodeInput{
			RunID:   handle.RunID(),
			Node:    node,
			Inputs:  cloneMap(inputs),
			Attempt: attempt,
		}, func(progress float64, message string) {
			if progress < 0 {
				progress = 0
			}
			if progress > 1 {
				progress = 1
			}
			state := result.NodeStates[node.ID]
			state.Progress = progress
			state.Message = message
			state.Attempts = attempt
			result.NodeStates[node.ID] = state
			handle.emit(events.Event{Type: events.NodeProgress, RunID: handle.RunID(), NodeID: node.ID, NodeType: node.Type, Status: StatusRunning, Progress: progress, Message: message})
		})
		if err == nil {
			return output, nil
		}
		lastErr = err
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
	}
	return nil, lastErr
}

func (e *Engine) cancelRemaining(handle *RunHandle, result *RunResult, doc *graph.GraphDocument, current graph.NodeID) {
	now := time.Now().UTC()
	for _, node := range doc.Nodes {
		state := result.NodeStates[node.ID]
		if state.Status == StatusSucceeded || state.Status == StatusFailed || state.Status == StatusCancelled {
			continue
		}
		state.Status = StatusCancelled
		state.EndedAt = now
		result.NodeStates[node.ID] = state
		if node.ID != current {
			handle.emit(events.Event{Type: events.NodeCancelled, RunID: handle.RunID(), NodeID: node.ID, NodeType: node.Type, Status: StatusCancelled, Message: "运行已取消"})
		}
	}
	result.Status = StatusCancelled
	result.EndedAt = now
	result.Error = context.Canceled.Error()
	handle.emit(events.Event{Type: events.RunCancelled, RunID: handle.RunID(), Status: StatusCancelled, Error: context.Canceled.Error()})
	handle.finish(result)
}

func gatherInputs(doc *graph.GraphDocument, nodeID string, outputs map[string]map[string]any, registry *schema.Registry) map[string]any {
	inputs := map[string]any{}
	node, ok := findNode(doc, nodeID)
	if !ok {
		return inputs
	}
	definition, _ := registry.Get(node.Type)
	for _, edge := range doc.Edges {
		if edge.Target != nodeID {
			continue
		}
		sourceOutputs := outputs[edge.Source]
		if sourceOutputs == nil {
			continue
		}
		value := sourceOutputs[edge.SourcePort]
		targetPort, _ := definition.Input(edge.TargetPort)
		if targetPort.Multiple {
			current, _ := inputs[edge.TargetPort].([]any)
			inputs[edge.TargetPort] = append(current, value)
		} else {
			inputs[edge.TargetPort] = value
		}
	}
	return inputs
}

func findNode(doc *graph.GraphDocument, nodeID string) (graph.Node, bool) {
	for _, node := range doc.Nodes {
		if node.ID == nodeID {
			return node, true
		}
	}
	return graph.Node{}, false
}

func statusFromError(err error) string {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return StatusCancelled
	}
	return StatusFailed
}

func hasExplicitStopOnError(options RunOptions) bool {
	return options.StopOnError
}

func cloneMap(in map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range in {
		out[k] = v
	}
	return out
}

func newRunID() string {
	return fmt.Sprintf("run-%d", time.Now().UTC().UnixNano())
}
