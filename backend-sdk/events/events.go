package events

import (
	"encoding/json"
	"time"
)

const (
	RunStarted       = "run.started"
	RunCompleted     = "run.completed"
	RunFailed        = "run.failed"
	RunCancelled     = "run.cancelled"
	NodeQueued       = "node.queued"
	NodeRunning      = "node.running"
	NodeProgress     = "node.progress"
	NodeSucceeded    = "node.succeeded"
	NodeFailed       = "node.failed"
	NodeCancelled    = "node.cancelled"
	ValidationFailed = "validation.failed"
)

type Event struct {
	Type      string         `json:"type"`
	RunID     string         `json:"runId,omitempty"`
	NodeID    string         `json:"nodeId,omitempty"`
	NodeType  string         `json:"nodeType,omitempty"`
	Status    string         `json:"status,omitempty"`
	Progress  float64        `json:"progress,omitempty"`
	Message   string         `json:"message,omitempty"`
	Error     string         `json:"error,omitempty"`
	Output    map[string]any `json:"output,omitempty"`
	Timestamp time.Time      `json:"timestamp"`
	Sequence  int64          `json:"sequence"`
}

func (e Event) JSON() []byte {
	data, err := json.Marshal(e)
	if err != nil {
		panic(err)
	}
	return data
}
