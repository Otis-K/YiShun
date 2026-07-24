package runtime

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/flowcanvas/flowcanvas-backend-sdk/events"
)

type RunHandle struct {
	runID    string
	cancel   context.CancelFunc
	observer RunObserver

	mu          sync.RWMutex
	seq         int64
	log         []events.Event
	subscribers map[chan events.Event]struct{}
	result      *RunResult
	completed   bool
	done        chan struct{}
}

func newRunHandle(runID string, cancel context.CancelFunc, observer RunObserver) *RunHandle {
	return &RunHandle{
		runID:       runID,
		cancel:      cancel,
		observer:    observer,
		log:         []events.Event{},
		subscribers: map[chan events.Event]struct{}{},
		done:        make(chan struct{}),
	}
}

func (h *RunHandle) RunID() string {
	return h.runID
}

func (h *RunHandle) Cancel() {
	h.cancel()
}

func (h *RunHandle) Done() <-chan struct{} {
	return h.done
}

func (h *RunHandle) Snapshot() (*RunResult, []events.Event, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	logCopy := append([]events.Event(nil), h.log...)
	var resultCopy *RunResult
	if h.result != nil {
		resultCopy = cloneResult(h.result)
	}
	return resultCopy, logCopy, h.completed
}

func (h *RunHandle) Wait(ctx context.Context) (*RunResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-h.done:
		h.mu.RLock()
		defer h.mu.RUnlock()
		if h.result == nil {
			return nil, errors.New("run finished without result")
		}
		return cloneResult(h.result), nil
	}
}

func (h *RunHandle) Subscribe(replay bool) (<-chan events.Event, func()) {
	ch := make(chan events.Event, 128)
	h.mu.Lock()
	if replay {
		for _, event := range h.log {
			ch <- event
		}
	}
	if h.completed {
		close(ch)
		h.mu.Unlock()
		return ch, func() {}
	}
	h.subscribers[ch] = struct{}{}
	h.mu.Unlock()

	unsubscribe := func() {
		h.mu.Lock()
		if _, ok := h.subscribers[ch]; ok {
			delete(h.subscribers, ch)
			close(ch)
		}
		h.mu.Unlock()
	}
	return ch, unsubscribe
}

func (h *RunHandle) emit(event events.Event) {
	h.mu.Lock()
	h.seq++
	event.Sequence = h.seq
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now().UTC()
	}
	h.log = append(h.log, event)
	if h.observer != nil {
		_ = h.observer.OnRunEvent(event)
	}
	for ch := range h.subscribers {
		select {
		case ch <- event:
		default:
		}
	}
	h.mu.Unlock()
}

func (h *RunHandle) finish(result *RunResult) {
	h.mu.Lock()
	if h.completed {
		h.mu.Unlock()
		return
	}
	h.result = cloneResult(result)
	if h.observer != nil {
		_ = h.observer.OnRunFinished(cloneResult(result))
	}
	h.completed = true
	for ch := range h.subscribers {
		close(ch)
		delete(h.subscribers, ch)
	}
	close(h.done)
	h.mu.Unlock()
}

func cloneResult(in *RunResult) *RunResult {
	if in == nil {
		return nil
	}
	out := *in
	out.NodeStates = map[string]NodeState{}
	for k, v := range in.NodeStates {
		out.NodeStates[k] = v
	}
	out.Outputs = map[string]map[string]any{}
	for nodeID, ports := range in.Outputs {
		out.Outputs[nodeID] = cloneMap(ports)
	}
	return &out
}
