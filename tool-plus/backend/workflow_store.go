package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

type WorkflowDefinition struct {
	ID             string         `json:"id"`
	Name           string         `json:"name"`
	Description    string         `json:"description,omitempty"`
	Version        int            `json:"version"`
	FailurePolicy  string         `json:"failurePolicy"`
	OutputPolicy   map[string]any `json:"outputPolicy"`
	ConflictPolicy string         `json:"conflictPolicy"`
	Notification   string         `json:"notification"`
	Concurrency    int            `json:"concurrency"`
	CreatedAt      string         `json:"createdAt"`
	UpdatedAt      string         `json:"updatedAt"`
	LastRunStatus  string         `json:"lastRunStatus,omitempty"`
	Steps          []WorkflowStep `json:"steps,omitempty"`
}

type WorkflowStep struct {
	ID           string            `json:"id"`
	WorkflowID   string            `json:"workflowId"`
	SortIndex    int               `json:"sortIndex"`
	Name         string            `json:"name"`
	Enabled      bool              `json:"enabled"`
	ToolKey      string            `json:"toolKey"`
	Options      map[string]string `json:"options"`
	InputBinding map[string]any    `json:"inputBinding"`
	CreatedAt    string            `json:"createdAt"`
	UpdatedAt    string            `json:"updatedAt"`
}

type WorkflowRun struct {
	ID               string         `json:"id"`
	WorkflowID       string         `json:"workflowId"`
	WorkflowVersion  int            `json:"workflowVersion"`
	Status           string         `json:"status"`
	InputManifest    map[string]any `json:"inputManifest"`
	FinalOutputDir   string         `json:"finalOutputDir"`
	Snapshot         map[string]any `json:"snapshot"`
	CheckpointStepID string         `json:"checkpointStepId,omitempty"`
	Summary          map[string]any `json:"summary"`
	StartedAt        string         `json:"startedAt"`
	EndedAt          string         `json:"endedAt,omitempty"`
}

type WorkflowIssue struct {
	Severity  string `json:"severity"`
	StepID    string `json:"stepId,omitempty"`
	StepIndex int    `json:"stepIndex,omitempty"`
	Field     string `json:"field,omitempty"`
	Message   string `json:"message"`
}

type WorkflowCommand struct {
	Action      string              `json:"action"`
	DBPath      string              `json:"dbPath"`
	WorkflowID  string              `json:"workflowId,omitempty"`
	StepID      string              `json:"stepId,omitempty"`
	Workflow    *WorkflowDefinition `json:"workflow,omitempty"`
	Step        *WorkflowStep       `json:"step,omitempty"`
	Run         *WorkflowRun        `json:"run,omitempty"`
	RunID       string              `json:"runId,omitempty"`
	OrderedIDs  []string            `json:"orderedIds,omitempty"`
	Enabled     *bool               `json:"enabled,omitempty"`
	ImportValue map[string]any      `json:"importValue,omitempty"`
}

type WorkflowResponse struct {
	OK     bool            `json:"ok"`
	Data   any             `json:"data,omitempty"`
	Issues []WorkflowIssue `json:"issues,omitempty"`
	Error  string          `json:"error,omitempty"`
}

func handleWorkflowCommand(command WorkflowCommand) (response WorkflowResponse) {
	defer func() {
		if recovered := recover(); recovered != nil {
			response = WorkflowResponse{OK: false, Error: fmt.Sprintf("workflow storage failure: %v", recovered)}
		}
	}()
	db, err := openWorkflowDB(command.DBPath)
	if err != nil {
		return WorkflowResponse{OK: false, Error: err.Error()}
	}
	defer db.Close()
	data, issues, err := executeWorkflowCommand(db, command)
	if err != nil {
		return WorkflowResponse{OK: false, Error: err.Error(), Issues: issues}
	}
	return WorkflowResponse{OK: true, Data: data, Issues: issues}
}

func openWorkflowDB(dbPath string) (*sql.DB, error) {
	if strings.TrimSpace(dbPath) == "" {
		return nil, errors.New("workflow database path is required")
	}
	absolute, err := filepath.Abs(dbPath)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", absolute)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	for _, pragma := range []string{"PRAGMA journal_mode=WAL", "PRAGMA foreign_keys=ON", "PRAGMA busy_timeout=5000"} {
		if _, err := db.Exec(pragma); err != nil {
			db.Close()
			return nil, err
		}
	}
	if err := migrateWorkflowDB(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func migrateWorkflowDB(db *sql.DB) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS workflow_definitions(
			id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
			failure_policy TEXT NOT NULL, output_policy_json TEXT NOT NULL, conflict_policy TEXT NOT NULL,
			notification TEXT NOT NULL, concurrency INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
		`CREATE TABLE IF NOT EXISTS workflow_steps(
			id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflow_definitions(id), sort_index INTEGER NOT NULL,
			name TEXT NOT NULL, enabled INTEGER NOT NULL, tool_key TEXT NOT NULL, options_json TEXT NOT NULL,
			input_binding_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(workflow_id, sort_index))`,
		`CREATE TABLE IF NOT EXISTS workflow_runs(
			id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, workflow_version INTEGER NOT NULL, status TEXT NOT NULL,
			input_manifest_json TEXT NOT NULL, final_output_dir TEXT NOT NULL, workflow_snapshot_json TEXT NOT NULL,
			checkpoint_step_id TEXT, summary_json TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT)`,
		`CREATE TABLE IF NOT EXISTS workflow_run_steps(
			id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES workflow_runs(id), step_id TEXT NOT NULL, attempt INTEGER NOT NULL,
			status TEXT NOT NULL, options_snapshot_json TEXT NOT NULL, input_manifest_path TEXT, output_manifest_path TEXT,
			timing_json TEXT NOT NULL, error_code TEXT, error_message TEXT, UNIQUE(run_id, step_id, attempt))`,
		`CREATE TABLE IF NOT EXISTS workflow_run_items(
			id TEXT PRIMARY KEY, run_step_id TEXT NOT NULL REFERENCES workflow_run_steps(id), source_artifact_id TEXT,
			output_artifact_id TEXT, status TEXT NOT NULL, duration_ms INTEGER, error_code TEXT, error_message TEXT)`,
		`CREATE TABLE IF NOT EXISTS execution_reservations(
			id TEXT PRIMARY KEY, run_step_id TEXT NOT NULL, server_reservation_id TEXT, permit_expiry TEXT, settle_status TEXT NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS workflow_steps_order ON workflow_steps(workflow_id, sort_index)`,
		`CREATE INDEX IF NOT EXISTS workflow_runs_recent ON workflow_runs(workflow_id, started_at DESC)`,
		`INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, CURRENT_TIMESTAMP)`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}

func executeWorkflowCommand(db *sql.DB, command WorkflowCommand) (any, []WorkflowIssue, error) {
	switch command.Action {
	case "list":
		return listWorkflows(db)
	case "get":
		return getWorkflow(db, command.WorkflowID)
	case "create":
		return createWorkflow(db, command.Workflow)
	case "update":
		return updateWorkflow(db, command.Workflow)
	case "delete":
		return nil, nil, softDeleteWorkflow(db, command.WorkflowID)
	case "delete-all":
		return nil, nil, softDeleteAllWorkflows(db)
	case "step-list":
		return listWorkflowSteps(db, command.WorkflowID)
	case "step-create":
		return createWorkflowStep(db, command.Step)
	case "step-update":
		return updateWorkflowStep(db, command.Step)
	case "step-delete":
		return nil, nil, deleteWorkflowStep(db, command.StepID)
	case "step-reorder":
		return nil, nil, reorderWorkflowSteps(db, command.WorkflowID, command.OrderedIDs)
	case "step-toggle":
		return toggleWorkflowStep(db, command.StepID, command.Enabled)
	case "step-duplicate":
		return duplicateWorkflowStep(db, command.StepID)
	case "validate":
		workflow, issues, err := loadAndValidateWorkflow(db, command.WorkflowID)
		return workflow, issues, err
	case "export":
		return exportWorkflow(db, command.WorkflowID)
	case "import":
		return importWorkflow(db, command.ImportValue)
	case "run-create":
		return createWorkflowRun(db, command.Run)
	case "run-update":
		return updateWorkflowRun(db, command.Run)
	case "run-get":
		return getWorkflowRun(db, command.RunID)
	case "run-list":
		return listWorkflowRuns(db, command.WorkflowID)
	default:
		return nil, nil, fmt.Errorf("unknown workflow action: %s", command.Action)
	}
}

func nowISO() string              { return time.Now().UTC().Format(time.RFC3339Nano) }
func encodeJSON(value any) string { data, _ := json.Marshal(value); return string(data) }
func decodeMap(value string) map[string]any {
	result := map[string]any{}
	_ = json.Unmarshal([]byte(value), &result)
	return result
}
func decodeOptions(value string) map[string]string {
	result := map[string]string{}
	_ = json.Unmarshal([]byte(value), &result)
	return result
}

func normalizeWorkflow(value *WorkflowDefinition) (*WorkflowDefinition, error) {
	if value == nil {
		return nil, errors.New("workflow payload is required")
	}
	copy := *value
	copy.Name = strings.TrimSpace(copy.Name)
	if copy.Name == "" {
		return nil, errors.New("任务名称不能为空")
	}
	if copy.FailurePolicy == "" {
		copy.FailurePolicy = "stop"
	}
	if copy.ConflictPolicy == "" {
		copy.ConflictPolicy = "auto-number"
	}
	if copy.Notification == "" {
		copy.Notification = "app"
	}
	if copy.OutputPolicy == nil {
		copy.OutputPolicy = map[string]any{"mode": "new-directory"}
	}
	return &copy, nil
}

func createWorkflow(db *sql.DB, value *WorkflowDefinition) (any, []WorkflowIssue, error) {
	workflow, err := normalizeWorkflow(value)
	if err != nil {
		return nil, nil, err
	}
	if workflow.ID == "" {
		workflow.ID = uuid.NewString()
	}
	workflow.Version = 1
	workflow.CreatedAt = nowISO()
	workflow.UpdatedAt = workflow.CreatedAt
	_, err = db.Exec(`INSERT INTO workflow_definitions(id,name,description,version,failure_policy,output_policy_json,conflict_policy,notification,concurrency,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
		workflow.ID, workflow.Name, workflow.Description, workflow.Version, workflow.FailurePolicy, encodeJSON(workflow.OutputPolicy), workflow.ConflictPolicy, workflow.Notification, workflow.Concurrency, workflow.CreatedAt, workflow.UpdatedAt)
	return workflow, nil, err
}

func updateWorkflow(db *sql.DB, value *WorkflowDefinition) (any, []WorkflowIssue, error) {
	workflow, err := normalizeWorkflow(value)
	if err != nil {
		return nil, nil, err
	}
	if workflow.ID == "" {
		return nil, nil, errors.New("workflow id is required")
	}
	workflow.UpdatedAt = nowISO()
	result, err := db.Exec(`UPDATE workflow_definitions SET name=?,description=?,version=version+1,failure_policy=?,output_policy_json=?,conflict_policy=?,notification=?,concurrency=?,updated_at=? WHERE id=? AND deleted_at IS NULL`,
		workflow.Name, workflow.Description, workflow.FailurePolicy, encodeJSON(workflow.OutputPolicy), workflow.ConflictPolicy, workflow.Notification, workflow.Concurrency, workflow.UpdatedAt, workflow.ID)
	if err != nil {
		return nil, nil, err
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return nil, nil, errors.New("任务不存在")
	}
	loaded, _, err := getWorkflow(db, workflow.ID)
	return loaded, nil, err
}

func listWorkflows(db *sql.DB) (any, []WorkflowIssue, error) {
	rows, err := db.Query(`SELECT d.id,d.name,d.description,d.version,d.failure_policy,d.output_policy_json,d.conflict_policy,d.notification,d.concurrency,d.created_at,d.updated_at,COALESCE((SELECT status FROM workflow_runs r WHERE r.workflow_id=d.id ORDER BY started_at DESC LIMIT 1),'') FROM workflow_definitions d WHERE deleted_at IS NULL ORDER BY updated_at DESC`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	items := []WorkflowDefinition{}
	for rows.Next() {
		var w WorkflowDefinition
		var output string
		if err := rows.Scan(&w.ID, &w.Name, &w.Description, &w.Version, &w.FailurePolicy, &output, &w.ConflictPolicy, &w.Notification, &w.Concurrency, &w.CreatedAt, &w.UpdatedAt, &w.LastRunStatus); err != nil {
			return nil, nil, err
		}
		w.OutputPolicy = decodeMap(output)
		items = append(items, w)
	}
	return items, nil, rows.Err()
}

func getWorkflow(db *sql.DB, id string) (any, []WorkflowIssue, error) {
	var w WorkflowDefinition
	var output string
	err := db.QueryRow(`SELECT id,name,description,version,failure_policy,output_policy_json,conflict_policy,notification,concurrency,created_at,updated_at FROM workflow_definitions WHERE id=? AND deleted_at IS NULL`, id).Scan(&w.ID, &w.Name, &w.Description, &w.Version, &w.FailurePolicy, &output, &w.ConflictPolicy, &w.Notification, &w.Concurrency, &w.CreatedAt, &w.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, errors.New("任务不存在")
		}
		return nil, nil, err
	}
	w.OutputPolicy = decodeMap(output)
	steps, _, err := listWorkflowSteps(db, id)
	if err != nil {
		return nil, nil, err
	}
	w.Steps = steps.([]WorkflowStep)
	return w, nil, nil
}

func softDeleteWorkflow(db *sql.DB, id string) error {
	_, err := db.Exec(`UPDATE workflow_definitions SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL`, nowISO(), nowISO(), id)
	return err
}
func softDeleteAllWorkflows(db *sql.DB) error {
	_, err := db.Exec(`UPDATE workflow_definitions SET deleted_at=?,updated_at=? WHERE deleted_at IS NULL`, nowISO(), nowISO())
	return err
}

func scanStep(scanner interface{ Scan(...any) error }) (WorkflowStep, error) {
	var s WorkflowStep
	var enabled int
	var options, binding string
	err := scanner.Scan(&s.ID, &s.WorkflowID, &s.SortIndex, &s.Name, &enabled, &s.ToolKey, &options, &binding, &s.CreatedAt, &s.UpdatedAt)
	s.Enabled = enabled != 0
	s.Options = decodeOptions(options)
	s.InputBinding = decodeMap(binding)
	return s, err
}
func listWorkflowSteps(db *sql.DB, workflowID string) (any, []WorkflowIssue, error) {
	rows, err := db.Query(`SELECT id,workflow_id,sort_index,name,enabled,tool_key,options_json,input_binding_json,created_at,updated_at FROM workflow_steps WHERE workflow_id=? ORDER BY sort_index`, workflowID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	items := []WorkflowStep{}
	for rows.Next() {
		s, e := scanStep(rows)
		if e != nil {
			return nil, nil, e
		}
		items = append(items, s)
	}
	return items, nil, rows.Err()
}

func createWorkflowStep(db *sql.DB, value *WorkflowStep) (any, []WorkflowIssue, error) {
	if value == nil || value.WorkflowID == "" || value.ToolKey == "" {
		return nil, nil, errors.New("步骤缺少任务或工具")
	}
	tool, ok := findTool(value.ToolKey)
	if !ok {
		return nil, nil, errors.New("未知工具")
	}
	if !tool.WorkflowCapable {
		return nil, nil, fmt.Errorf("工具不可编排: %s", tool.WorkflowUnavailableReason)
	}
	tx, err := db.Begin()
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()
	var next int
	if value.SortIndex <= 0 {
		_ = tx.QueryRow(`SELECT COALESCE(MAX(sort_index),0)+1 FROM workflow_steps WHERE workflow_id=?`, value.WorkflowID).Scan(&next)
	} else {
		next = value.SortIndex
		if _, err = tx.Exec(`UPDATE workflow_steps SET sort_index=sort_index+1 WHERE workflow_id=? AND sort_index>=?`, value.WorkflowID, next); err != nil {
			return nil, nil, err
		}
	}
	now := nowISO()
	step := *value
	if step.ID == "" {
		step.ID = uuid.NewString()
	}
	step.SortIndex = next
	if strings.TrimSpace(step.Name) == "" {
		step.Name = tool.Title
	}
	if step.Options == nil {
		step.Options = map[string]string{}
	}
	if step.InputBinding == nil {
		step.InputBinding = map[string]any{"mode": "previous"}
	}
	step.CreatedAt = now
	step.UpdatedAt = now
	_, err = tx.Exec(`INSERT INTO workflow_steps(id,workflow_id,sort_index,name,enabled,tool_key,options_json,input_binding_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, step.ID, step.WorkflowID, step.SortIndex, step.Name, boolInt(step.Enabled), step.ToolKey, encodeJSON(step.Options), encodeJSON(step.InputBinding), now, now)
	if err != nil {
		return nil, nil, err
	}
	if _, err = tx.Exec(`UPDATE workflow_definitions SET version=version+1,updated_at=? WHERE id=? AND deleted_at IS NULL`, now, step.WorkflowID); err != nil {
		return nil, nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, nil, err
	}
	return step, nil, nil
}

func updateWorkflowStep(db *sql.DB, value *WorkflowStep) (any, []WorkflowIssue, error) {
	if value == nil || value.ID == "" {
		return nil, nil, errors.New("step id is required")
	}
	tool, ok := findTool(value.ToolKey)
	if !ok {
		return nil, nil, errors.New("未知工具")
	}
	if !tool.WorkflowCapable {
		return nil, nil, fmt.Errorf("工具不可编排: %s", tool.WorkflowUnavailableReason)
	}
	now := nowISO()
	result, err := db.Exec(`UPDATE workflow_steps SET name=?,enabled=?,tool_key=?,options_json=?,input_binding_json=?,updated_at=? WHERE id=?`, strings.TrimSpace(value.Name), boolInt(value.Enabled), value.ToolKey, encodeJSON(value.Options), encodeJSON(value.InputBinding), now, value.ID)
	if err != nil {
		return nil, nil, err
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return nil, nil, errors.New("步骤不存在")
	}
	_, err = db.Exec(`UPDATE workflow_definitions SET version=version+1,updated_at=? WHERE id=(SELECT workflow_id FROM workflow_steps WHERE id=?)`, now, value.ID)
	if err != nil {
		return nil, nil, err
	}
	row := db.QueryRow(`SELECT id,workflow_id,sort_index,name,enabled,tool_key,options_json,input_binding_json,created_at,updated_at FROM workflow_steps WHERE id=?`, value.ID)
	step, err := scanStep(row)
	return step, nil, err
}
func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func deleteWorkflowStep(db *sql.DB, id string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var workflowID string
	var sortIndex int
	if err = tx.QueryRow(`SELECT workflow_id,sort_index FROM workflow_steps WHERE id=?`, id).Scan(&workflowID, &sortIndex); err != nil {
		return errors.New("步骤不存在")
	}
	if _, err = tx.Exec(`DELETE FROM workflow_steps WHERE id=?`, id); err != nil {
		return err
	}
	if _, err = tx.Exec(`UPDATE workflow_steps SET sort_index=sort_index-1 WHERE workflow_id=? AND sort_index>?`, workflowID, sortIndex); err != nil {
		return err
	}
	if _, err = tx.Exec(`UPDATE workflow_definitions SET version=version+1,updated_at=? WHERE id=?`, nowISO(), workflowID); err != nil {
		return err
	}
	return tx.Commit()
}

func reorderWorkflowSteps(db *sql.DB, workflowID string, ids []string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var count int
	if err = tx.QueryRow(`SELECT COUNT(*) FROM workflow_steps WHERE workflow_id=?`, workflowID).Scan(&count); err != nil {
		return err
	}
	if count != len(ids) {
		return errors.New("排序列表与步骤数量不一致")
	}
	if _, err = tx.Exec(`UPDATE workflow_steps SET sort_index=-sort_index WHERE workflow_id=?`, workflowID); err != nil {
		return err
	}
	for index, id := range ids {
		result, e := tx.Exec(`UPDATE workflow_steps SET sort_index=?,updated_at=? WHERE id=? AND workflow_id=?`, index+1, nowISO(), id, workflowID)
		if e != nil {
			return e
		}
		if n, _ := result.RowsAffected(); n != 1 {
			return errors.New("排序包含未知步骤")
		}
	}
	if _, err = tx.Exec(`UPDATE workflow_definitions SET version=version+1,updated_at=? WHERE id=?`, nowISO(), workflowID); err != nil {
		return err
	}
	return tx.Commit()
}

func toggleWorkflowStep(db *sql.DB, id string, enabled *bool) (any, []WorkflowIssue, error) {
	if enabled == nil {
		return nil, nil, errors.New("enabled is required")
	}
	var s WorkflowStep
	var e int
	var options, binding string
	err := db.QueryRow(`SELECT id,workflow_id,sort_index,name,enabled,tool_key,options_json,input_binding_json,created_at,updated_at FROM workflow_steps WHERE id=?`, id).Scan(&s.ID, &s.WorkflowID, &s.SortIndex, &s.Name, &e, &s.ToolKey, &options, &binding, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return nil, nil, errors.New("步骤不存在")
	}
	if !*enabled {
		var count int
		_ = db.QueryRow(`SELECT COUNT(*) FROM workflow_steps WHERE workflow_id=? AND enabled=1`, s.WorkflowID).Scan(&count)
		if count <= 1 {
			return nil, nil, errors.New("至少保留一条启用步骤")
		}
	}
	_, err = db.Exec(`UPDATE workflow_steps SET enabled=?,updated_at=? WHERE id=?`, boolInt(*enabled), nowISO(), id)
	if err != nil {
		return nil, nil, err
	}
	_, err = db.Exec(`UPDATE workflow_definitions SET version=version+1,updated_at=? WHERE id=?`, nowISO(), s.WorkflowID)
	s.Enabled = *enabled
	s.Options = decodeOptions(options)
	s.InputBinding = decodeMap(binding)
	return s, nil, err
}

func duplicateWorkflowStep(db *sql.DB, id string) (any, []WorkflowIssue, error) {
	row := db.QueryRow(`SELECT id,workflow_id,sort_index,name,enabled,tool_key,options_json,input_binding_json,created_at,updated_at FROM workflow_steps WHERE id=?`, id)
	step, err := scanStep(row)
	if err != nil {
		return nil, nil, errors.New("步骤不存在")
	}
	step.ID = ""
	step.Name += " - 副本"
	step.SortIndex++
	return createWorkflowStep(db, &step)
}

func loadAndValidateWorkflow(db *sql.DB, id string) (any, []WorkflowIssue, error) {
	value, _, err := getWorkflow(db, id)
	if err != nil {
		return nil, nil, err
	}
	workflow := value.(WorkflowDefinition)
	issues := validateWorkflow(workflow)
	return workflow, issues, nil
}
func validateWorkflow(workflow WorkflowDefinition) []WorkflowIssue {
	issues := []WorkflowIssue{}
	enabled := []WorkflowStep{}
	for _, step := range workflow.Steps {
		if step.Enabled {
			enabled = append(enabled, step)
		}
	}
	if len(enabled) == 0 {
		return []WorkflowIssue{{Severity: "error", Message: "任务至少需要一条启用步骤"}}
	}
	for index, step := range enabled {
		tool, ok := findTool(step.ToolKey)
		if !ok {
			issues = append(issues, WorkflowIssue{Severity: "error", StepID: step.ID, StepIndex: index + 1, Field: "toolKey", Message: "工具不存在"})
			continue
		}
		if !tool.WorkflowCapable {
			issues = append(issues, WorkflowIssue{Severity: "error", StepID: step.ID, StepIndex: index + 1, Field: "toolKey", Message: tool.WorkflowUnavailableReason})
		}
		if index > 0 {
			previous, _ := findTool(enabled[index-1].ToolKey)
			if !contractsConnect(previous.OutputContract, tool.InputContract) {
				issues = append(issues, WorkflowIssue{Severity: "error", StepID: step.ID, StepIndex: index + 1, Field: "inputBinding", Message: fmt.Sprintf("第 %d 步输出类型 %v 与第 %d 步输入类型 %v 不兼容", index, previous.OutputContract["extensions"], index+1, tool.InputContract["extensions"])})
			}
		}
	}
	return issues
}
func contractsConnect(output, input map[string]any) bool {
	if input["kind"] == "none" {
		return false
	}
	out := stringSlice(output["extensions"])
	in := stringSlice(input["extensions"])
	if contains(out, "*") || contains(in, "*") {
		return true
	}
	for _, a := range out {
		for _, b := range in {
			if strings.EqualFold(a, b) {
				return true
			}
		}
	}
	return false
}
func stringSlice(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		result := []string{}
		for _, v := range typed {
			result = append(result, fmt.Sprint(v))
		}
		return result
	}
	return nil
}
func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func exportWorkflow(db *sql.DB, id string) (any, []WorkflowIssue, error) {
	value, issues, err := loadAndValidateWorkflow(db, id)
	if err != nil {
		return nil, issues, err
	}
	return map[string]any{"schemaVersion": 1, "workflow": value}, issues, nil
}
func importWorkflow(db *sql.DB, value map[string]any) (any, []WorkflowIssue, error) {
	if intValue(value["schemaVersion"]) != 1 {
		return nil, nil, errors.New("不支持的任务 schemaVersion")
	}
	raw, ok := value["workflow"]
	if !ok {
		return nil, nil, errors.New("导入文件缺少 workflow")
	}
	data, _ := json.Marshal(raw)
	var workflow WorkflowDefinition
	if err := json.Unmarshal(data, &workflow); err != nil {
		return nil, nil, err
	}
	workflow.ID = ""
	workflow.Name = strings.TrimSpace(workflow.Name) + " - 导入"
	created, _, err := createWorkflow(db, &workflow)
	if err != nil {
		return nil, nil, err
	}
	newWorkflow := created.(*WorkflowDefinition)
	sort.Slice(workflow.Steps, func(i, j int) bool { return workflow.Steps[i].SortIndex < workflow.Steps[j].SortIndex })
	for _, step := range workflow.Steps {
		step.ID = ""
		step.WorkflowID = newWorkflow.ID
		if _, _, err = createWorkflowStep(db, &step); err != nil {
			return nil, nil, err
		}
	}
	return getWorkflow(db, newWorkflow.ID)
}
func intValue(value any) int {
	switch v := value.(type) {
	case int:
		return v
	case float64:
		return int(v)
	case json.Number:
		n, _ := v.Int64()
		return int(n)
	}
	return 0
}

func createWorkflowRun(db *sql.DB, value *WorkflowRun) (any, []WorkflowIssue, error) {
	if value == nil {
		return nil, nil, errors.New("run payload is required")
	}
	run := *value
	if run.ID == "" {
		run.ID = uuid.NewString()
	}
	if run.Status == "" {
		run.Status = "queued"
	}
	if run.StartedAt == "" {
		run.StartedAt = nowISO()
	}
	if run.InputManifest == nil {
		run.InputManifest = map[string]any{}
	}
	if run.Snapshot == nil {
		run.Snapshot = map[string]any{}
	}
	if run.Summary == nil {
		run.Summary = map[string]any{}
	}
	_, err := db.Exec(`INSERT INTO workflow_runs(id,workflow_id,workflow_version,status,input_manifest_json,final_output_dir,workflow_snapshot_json,checkpoint_step_id,summary_json,started_at,ended_at) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)`, run.ID, run.WorkflowID, run.WorkflowVersion, run.Status, encodeJSON(run.InputManifest), run.FinalOutputDir, encodeJSON(run.Snapshot), nil, encodeJSON(run.Summary), run.StartedAt)
	return run, nil, err
}
func updateWorkflowRun(db *sql.DB, value *WorkflowRun) (any, []WorkflowIssue, error) {
	if value == nil || value.ID == "" {
		return nil, nil, errors.New("run id is required")
	}
	var ended any
	if value.EndedAt != "" {
		ended = value.EndedAt
	}
	_, err := db.Exec(`UPDATE workflow_runs SET status=?,checkpoint_step_id=?,summary_json=?,ended_at=? WHERE id=?`, value.Status, nullString(value.CheckpointStepID), encodeJSON(value.Summary), ended, value.ID)
	if err != nil {
		return nil, nil, err
	}
	return getWorkflowRun(db, value.ID)
}
func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
func getWorkflowRun(db *sql.DB, id string) (any, []WorkflowIssue, error) {
	var r WorkflowRun
	var input, snapshot, summary string
	var checkpoint, ended sql.NullString
	err := db.QueryRow(`SELECT id,workflow_id,workflow_version,status,input_manifest_json,final_output_dir,workflow_snapshot_json,checkpoint_step_id,summary_json,started_at,ended_at FROM workflow_runs WHERE id=?`, id).Scan(&r.ID, &r.WorkflowID, &r.WorkflowVersion, &r.Status, &input, &r.FinalOutputDir, &snapshot, &checkpoint, &summary, &r.StartedAt, &ended)
	if err != nil {
		return nil, nil, err
	}
	r.InputManifest = decodeMap(input)
	r.Snapshot = decodeMap(snapshot)
	r.Summary = decodeMap(summary)
	r.CheckpointStepID = checkpoint.String
	r.EndedAt = ended.String
	return r, nil, nil
}
func listWorkflowRuns(db *sql.DB, workflowID string) (any, []WorkflowIssue, error) {
	query := `SELECT id,workflow_id,workflow_version,status,input_manifest_json,final_output_dir,workflow_snapshot_json,checkpoint_step_id,summary_json,started_at,ended_at FROM workflow_runs`
	args := []any{}
	if workflowID != "" {
		query += ` WHERE workflow_id=?`
		args = append(args, workflowID)
	}
	query += ` ORDER BY started_at DESC LIMIT 200`
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	runs := []WorkflowRun{}
	for rows.Next() {
		var run WorkflowRun
		var input, snapshot, summary string
		var checkpoint, ended sql.NullString
		if err = rows.Scan(&run.ID, &run.WorkflowID, &run.WorkflowVersion, &run.Status, &input, &run.FinalOutputDir, &snapshot, &checkpoint, &summary, &run.StartedAt, &ended); err != nil {
			return nil, nil, err
		}
		run.InputManifest = decodeMap(input)
		run.Snapshot = decodeMap(snapshot)
		run.Summary = decodeMap(summary)
		run.CheckpointStepID = checkpoint.String
		run.EndedAt = ended.String
		runs = append(runs, run)
	}
	return runs, nil, rows.Err()
}
