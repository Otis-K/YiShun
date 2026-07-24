package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/flowcanvas/flowcanvas-backend-sdk/events"
	"github.com/flowcanvas/flowcanvas-backend-sdk/graph"
	"github.com/flowcanvas/flowcanvas-backend-sdk/runtime"
	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

type RunSummary = runtime.RunSummary
type StoredRun = runtime.StoredRun

func Open(path string) (*Store, error) {
	if path == "" {
		return nil, errors.New("sqlite database path is required")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if err := ensureParentDir(absolute); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", absolute)
	if err != nil {
		return nil, err
	}
	store := &Store{db: db}
	if err := store.Init(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func ensureParentDir(path string) error {
	dir := filepath.Dir(path)
	if dir == "." || dir == "" {
		return nil
	}
	return os.MkdirAll(dir, 0o755)
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) Init(ctx context.Context) error {
	if s == nil || s.db == nil {
		return errors.New("sqlite store is nil")
	}
	stmts := []string{
		`PRAGMA journal_mode=WAL;`,
		`CREATE TABLE IF NOT EXISTS flow_runs (
			run_id TEXT PRIMARY KEY,
			graph_id TEXT,
			graph_name TEXT,
			status TEXT NOT NULL,
			error TEXT,
			graph_json TEXT,
			result_json TEXT,
			created_at TEXT NOT NULL,
			started_at TEXT,
			ended_at TEXT,
			updated_at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS flow_events (
			run_id TEXT NOT NULL,
			sequence INTEGER NOT NULL,
			type TEXT NOT NULL,
			node_id TEXT,
			node_type TEXT,
			status TEXT,
			progress REAL,
			message TEXT,
			error TEXT,
			output_json TEXT,
			event_json TEXT NOT NULL,
			timestamp TEXT NOT NULL,
			PRIMARY KEY (run_id, sequence)
		);`,
		`CREATE INDEX IF NOT EXISTS idx_flow_events_run_id_sequence ON flow_events(run_id, sequence);`,
		`CREATE INDEX IF NOT EXISTS idx_flow_runs_updated_at ON flow_runs(updated_at);`,
	}
	for _, stmt := range stmts {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) OnRunCreated(record runtime.RunRecord) error {
	if s == nil || s.db == nil {
		return errors.New("sqlite store is nil")
	}
	graphJSON, err := json.Marshal(record.Graph)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	createdAt := record.CreatedAt
	if createdAt.IsZero() {
		createdAt = now
	}
	_, err = s.db.ExecContext(context.Background(), `INSERT INTO flow_runs
		(run_id, graph_id, graph_name, status, graph_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(run_id) DO UPDATE SET
			graph_id=excluded.graph_id,
			graph_name=excluded.graph_name,
			status=excluded.status,
			graph_json=excluded.graph_json,
			updated_at=excluded.updated_at`,
		record.RunID, record.GraphID, record.GraphName, record.Status, string(graphJSON), formatTime(createdAt), formatTime(now))
	return err
}

func (s *Store) OnRunEvent(event events.Event) error {
	if s == nil || s.db == nil {
		return errors.New("sqlite store is nil")
	}
	eventJSON, err := json.Marshal(event)
	if err != nil {
		return err
	}
	outputJSON := ""
	if event.Output != nil {
		data, err := json.Marshal(event.Output)
		if err != nil {
			return err
		}
		outputJSON = string(data)
	}
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now().UTC()
	}
	_, err = s.db.ExecContext(context.Background(), `INSERT OR REPLACE INTO flow_events
		(run_id, sequence, type, node_id, node_type, status, progress, message, error, output_json, event_json, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		event.RunID, event.Sequence, event.Type, event.NodeID, event.NodeType, event.Status, event.Progress,
		event.Message, event.Error, outputJSON, string(eventJSON), formatTime(event.Timestamp))
	if err != nil {
		return err
	}
	if event.Type == events.RunStarted {
		_, _ = s.db.ExecContext(context.Background(), `UPDATE flow_runs SET status=?, started_at=?, updated_at=? WHERE run_id=?`,
			event.Status, formatTime(event.Timestamp), formatTime(time.Now().UTC()), event.RunID)
	}
	return nil
}

func (s *Store) OnRunFinished(result *runtime.RunResult) error {
	if s == nil || s.db == nil {
		return errors.New("sqlite store is nil")
	}
	if result == nil {
		return nil
	}
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(context.Background(), `UPDATE flow_runs
		SET status=?, error=?, result_json=?, started_at=?, ended_at=?, updated_at=?
		WHERE run_id=?`,
		result.Status, result.Error, string(resultJSON), formatTime(result.StartedAt), formatTime(result.EndedAt), formatTime(time.Now().UTC()), result.RunID)
	return err
}

func (s *Store) ListRuns(ctx context.Context, limit int) ([]RunSummary, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `SELECT run_id, graph_id, graph_name, status, error, created_at, started_at, ended_at, updated_at
		FROM flow_runs ORDER BY updated_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RunSummary{}
	for rows.Next() {
		var item RunSummary
		var graphID, graphName, errText, createdAt, startedAt, endedAt, updatedAt sql.NullString
		if err := rows.Scan(&item.RunID, &graphID, &graphName, &item.Status, &errText, &createdAt, &startedAt, &endedAt, &updatedAt); err != nil {
			return nil, err
		}
		item.GraphID = graphID.String
		item.GraphName = graphName.String
		item.Error = errText.String
		item.CreatedAt, _ = parseTime(createdAt.String)
		if parsed, ok := parseOptionalTime(startedAt.String); ok {
			item.StartedAt = &parsed
		}
		if parsed, ok := parseOptionalTime(endedAt.String); ok {
			item.EndedAt = &parsed
		}
		item.UpdatedAt, _ = parseTime(updatedAt.String)
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) GetStoredRun(ctx context.Context, runID string) (*StoredRun, error) {
	row := s.db.QueryRowContext(ctx, `SELECT run_id, graph_id, graph_name, status, error, graph_json, result_json, created_at, started_at, ended_at, updated_at
		FROM flow_runs WHERE run_id=?`, runID)
	var item StoredRun
	var graphID, graphName, errText, graphJSON, resultJSON, createdAt, startedAt, endedAt, updatedAt sql.NullString
	if err := row.Scan(&item.RunID, &graphID, &graphName, &item.Status, &errText, &graphJSON, &resultJSON, &createdAt, &startedAt, &endedAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("stored run not found: %s", runID)
		}
		return nil, err
	}
	item.GraphID = graphID.String
	item.GraphName = graphName.String
	item.Error = errText.String
	item.CreatedAt, _ = parseTime(createdAt.String)
	if parsed, ok := parseOptionalTime(startedAt.String); ok {
		item.StartedAt = &parsed
	}
	if parsed, ok := parseOptionalTime(endedAt.String); ok {
		item.EndedAt = &parsed
	}
	item.UpdatedAt, _ = parseTime(updatedAt.String)
	if graphJSON.String != "" {
		var doc graph.GraphDocument
		if err := json.Unmarshal([]byte(graphJSON.String), &doc); err != nil {
			return nil, err
		}
		doc.Normalize()
		item.Graph = &doc
	}
	if resultJSON.String != "" {
		var result runtime.RunResult
		if err := json.Unmarshal([]byte(resultJSON.String), &result); err != nil {
			return nil, err
		}
		item.Result = &result
	}
	return &item, nil
}

func (s *Store) Events(ctx context.Context, runID string, afterSequence int64) ([]events.Event, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT event_json FROM flow_events WHERE run_id=? AND sequence>? ORDER BY sequence ASC`, runID, afterSequence)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []events.Event{}
	for rows.Next() {
		var data string
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		var event events.Event
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			return nil, err
		}
		out = append(out, event)
	}
	return out, rows.Err()
}

func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}

func parseOptionalTime(value string) (time.Time, bool) {
	if value == "" {
		return time.Time{}, false
	}
	t, err := parseTime(value)
	return t, err == nil
}

func parseTime(value string) (time.Time, error) {
	if value == "" {
		return time.Time{}, nil
	}
	return time.Parse(time.RFC3339Nano, value)
}
