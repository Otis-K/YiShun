package transport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/flowcanvas/flowcanvas-backend-sdk/events"
	"github.com/flowcanvas/flowcanvas-backend-sdk/graph"
	"github.com/flowcanvas/flowcanvas-backend-sdk/runtime"
	"github.com/flowcanvas/flowcanvas-backend-sdk/validator"
)

type Server struct {
	Engine  *runtime.Engine
	Archive RunArchive
}

type RunArchive interface {
	ListRuns(ctx context.Context, limit int) ([]runtime.RunSummary, error)
	GetStoredRun(ctx context.Context, runID string) (*runtime.StoredRun, error)
	Events(ctx context.Context, runID string, afterSequence int64) ([]events.Event, error)
}

func NewServer(engine *runtime.Engine) *Server {
	return &Server{Engine: engine}
}

func NewServerWithArchive(engine *runtime.Engine, archive RunArchive) *Server {
	return &Server{Engine: engine, Archive: archive}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/flow/validate", s.handleValidate)
	mux.HandleFunc("/api/flow/run", s.handleRun)
	mux.HandleFunc("/api/flow/run-node", s.handleRunNode)
	mux.HandleFunc("/api/flow/cancel", s.handleCancel)
	mux.HandleFunc("/api/flow/runs", s.handleRunList)
	mux.HandleFunc("/api/flow/runs/", s.handleRuns)
	mux.HandleFunc("/api/flow/health", s.handleHealth)
	return withJSONDefaults(mux)
}

type graphEnvelope struct {
	Graph   *graph.GraphDocument `json:"graph"`
	Options runtime.RunOptions   `json:"options"`
	NodeID  string               `json:"nodeId"`
	Inputs  map[string]any       `json:"inputs"`
	RunID   string               `json:"runId"`
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "flowcanvas-backend-sdk"})
}

func (s *Server) handleValidate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	doc, _, err := decodeGraphRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result := validator.Validate(doc, s.Engine.Registry())
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	doc, envelope, err := decodeGraphRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	handle, err := s.Engine.Run(context.Background(), doc, envelope.Options)
	if err != nil {
		var validationErr validator.GraphValidationError
		if errors.As(err, &validationErr) {
			writeJSON(w, http.StatusBadRequest, validationErr.Result)
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"runId":  handle.RunID(),
		"status": runtime.StatusRunning,
		"events": fmt.Sprintf("/api/flow/runs/%s/events", handle.RunID()),
	})
}

func (s *Server) handleRunNode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	doc, envelope, err := decodeGraphRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if envelope.NodeID == "" {
		writeError(w, http.StatusBadRequest, "nodeId is required")
		return
	}
	result, err := s.Engine.RunNode(r.Context(), doc, envelope.NodeID, envelope.Inputs)
	if err != nil {
		var validationErr validator.GraphValidationError
		if errors.As(err, &validationErr) {
			writeJSON(w, http.StatusBadRequest, validationErr.Result)
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req graphEnvelope
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.RunID == "" {
		writeError(w, http.StatusBadRequest, "runId is required")
		return
	}
	if err := s.Engine.CancelRun(req.RunID); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "runId": req.RunID})
}

func (s *Server) handleRuns(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/flow/runs/")
	if path == "" {
		writeError(w, http.StatusNotFound, "runId is required")
		return
	}
	if strings.HasSuffix(path, "/events") {
		runID := strings.TrimSuffix(path, "/events")
		runID = strings.TrimSuffix(runID, "/")
		s.handleEvents(w, r, runID)
		return
	}
	runID := strings.Trim(path, "/")
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	handle, ok := s.Engine.GetRun(runID)
	if !ok {
		if s.Archive != nil {
			stored, err := s.Archive.GetStoredRun(r.Context(), runID)
			if err != nil {
				writeError(w, http.StatusNotFound, "run not found")
				return
			}
			eventLog, _ := s.Archive.Events(r.Context(), runID, 0)
			writeJSON(w, http.StatusOK, map[string]any{
				"runId": runID, "completed": stored.Result != nil, "eventCount": len(eventLog), "result": stored.Result, "stored": stored,
			})
			return
		}
		writeError(w, http.StatusNotFound, "run not found")
		return
	}
	result, log, completed := handle.Snapshot()
	writeJSON(w, http.StatusOK, map[string]any{
		"runId": runID, "completed": completed, "eventCount": len(log), "result": result,
	})
}

func (s *Server) handleRunList(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/flow/runs" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.Archive == nil {
		writeJSON(w, http.StatusOK, map[string]any{"runs": []any{}})
		return
	}
	limit := 100
	if value := r.URL.Query().Get("limit"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	runs, err := s.Archive.ListRuns(r.Context(), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"runs": runs})
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request, runID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	handle, ok := s.Engine.GetRun(runID)
	if !ok {
		if s.Archive != nil {
			flusher, ok := w.(http.Flusher)
			if !ok {
				writeError(w, http.StatusInternalServerError, "streaming unsupported")
				return
			}
			events, err := s.Archive.Events(r.Context(), runID, 0)
			if err != nil {
				writeError(w, http.StatusNotFound, "run not found")
				return
			}
			w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
			w.Header().Set("Cache-Control", "no-cache")
			w.Header().Set("Connection", "keep-alive")
			for _, event := range events {
				writeSSE(w, event)
			}
			flusher.Flush()
			return
		}
		writeError(w, http.StatusNotFound, "run not found")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	ch, unsubscribe := handle.Subscribe(true)
	defer unsubscribe()
	for {
		select {
		case <-r.Context().Done():
			return
		case event, ok := <-ch:
			if !ok {
				return
			}
			writeSSE(w, event)
			flusher.Flush()
		}
	}
}

func decodeGraphRequest(r *http.Request) (*graph.GraphDocument, graphEnvelope, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 20<<20))
	if err != nil {
		return nil, graphEnvelope{}, err
	}
	if len(strings.TrimSpace(string(body))) == 0 {
		return nil, graphEnvelope{}, errors.New("request body is empty")
	}
	var envelope graphEnvelope
	if err := json.Unmarshal(body, &envelope); err == nil && envelope.Graph != nil {
		envelope.Graph.Normalize()
		return envelope.Graph, envelope, nil
	}
	doc, err := graph.ParseDocument(body)
	if err != nil {
		return nil, graphEnvelope{}, err
	}
	return doc, graphEnvelope{Graph: doc}, nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"ok": false, "error": message})
}

func writeSSE(w io.Writer, event events.Event) {
	_, _ = fmt.Fprintf(w, "event: %s\n", event.Type)
	_, _ = fmt.Fprintf(w, "data: %s\n\n", event.JSON())
}

func withJSONDefaults(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "content-type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
