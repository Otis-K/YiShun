package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWorkflowStoreLifecycleAndCompatibility(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "workflow.db")
	db, err := openWorkflowDB(dbPath)
	if err != nil {
		t.Fatal(err)
	}

	created, _, err := createWorkflow(db, &WorkflowDefinition{Name: "Markdown 发布", FailurePolicy: "stop"})
	if err != nil {
		t.Fatal(err)
	}
	workflow := created.(*WorkflowDefinition)
	first, _, err := createWorkflowStep(db, &WorkflowStep{WorkflowID: workflow.ID, Name: "转网页", Enabled: true, ToolKey: "markdown-to-html"})
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := createWorkflowStep(db, &WorkflowStep{WorkflowID: workflow.ID, Name: "转文本", Enabled: true, ToolKey: "html-to-txt"})
	if err != nil {
		t.Fatal(err)
	}

	loadedValue, issues, err := loadAndValidateWorkflow(db, workflow.ID)
	if err != nil {
		t.Fatal(err)
	}
	loaded := loadedValue.(WorkflowDefinition)
	if len(loaded.Steps) != 2 || len(issues) != 0 {
		t.Fatalf("steps=%d issues=%+v", len(loaded.Steps), issues)
	}

	firstStep := first.(WorkflowStep)
	secondStep := second.(WorkflowStep)
	if err := reorderWorkflowSteps(db, workflow.ID, []string{secondStep.ID, firstStep.ID}); err != nil {
		t.Fatal(err)
	}
	reordered, _, err := listWorkflowSteps(db, workflow.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reordered.([]WorkflowStep)[0].ID != secondStep.ID {
		t.Fatal("step order was not persisted")
	}

	falseValue := false
	if _, _, err := toggleWorkflowStep(db, secondStep.ID, &falseValue); err != nil {
		t.Fatal(err)
	}
	if _, _, err := toggleWorkflowStep(db, firstStep.ID, &falseValue); err == nil {
		t.Fatal("last enabled step was allowed to be disabled")
	}

	exported, _, err := exportWorkflow(db, workflow.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := importWorkflow(db, exported.(map[string]any)); err != nil {
		t.Fatal(err)
	}
	listed, _, err := listWorkflows(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.([]WorkflowDefinition)) != 2 {
		t.Fatalf("expected imported copy, got %d", len(listed.([]WorkflowDefinition)))
	}

	runValue, _, err := createWorkflowRun(db, &WorkflowRun{WorkflowID: workflow.ID, WorkflowVersion: loaded.Version, Status: "running", FinalOutputDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	run := runValue.(WorkflowRun)
	run.Status = "completed"
	run.CheckpointStepID = firstStep.ID
	run.EndedAt = nowISO()
	if _, _, err := updateWorkflowRun(db, &run); err != nil {
		t.Fatal(err)
	}
	db.Close()

	if _, err := os.Stat(dbPath); err != nil {
		t.Fatal(err)
	}
	reopened, err := openWorkflowDB(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	persisted, _, err := getWorkflowRun(reopened, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.(WorkflowRun).Status != "completed" {
		t.Fatal("run status did not survive reopen")
	}
	listedRuns, _, err := listWorkflowRuns(reopened, workflow.ID)
	if err != nil {
		t.Fatal(err)
	}
	runs := listedRuns.([]WorkflowRun)
	if len(runs) != 1 || runs[0].ID != run.ID || runs[0].Status != "completed" {
		t.Fatalf("unexpected persisted run list: %+v", runs)
	}
}

func TestWorkflowStoreRejectsIncompatibleAndUnstableTools(t *testing.T) {
	db, err := openWorkflowDB(filepath.Join(t.TempDir(), "workflow.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	created, _, err := createWorkflow(db, &WorkflowDefinition{Name: "不兼容示例"})
	if err != nil {
		t.Fatal(err)
	}
	workflow := created.(*WorkflowDefinition)
	if _, _, err := createWorkflowStep(db, &WorkflowStep{WorkflowID: workflow.ID, Enabled: true, ToolKey: "pdf-to-txt"}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := createWorkflowStep(db, &WorkflowStep{WorkflowID: workflow.ID, Enabled: true, ToolKey: "audio-to-mp3"}); err != nil {
		t.Fatal(err)
	}
	_, issues, err := loadAndValidateWorkflow(db, workflow.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(issues) != 1 || issues[0].Severity != "error" || issues[0].StepIndex != 2 {
		t.Fatalf("unexpected issues: %+v", issues)
	}
	if _, _, err := createWorkflowStep(db, &WorkflowStep{WorkflowID: workflow.ID, Enabled: true, ToolKey: "web-video-download"}); err == nil {
		t.Fatal("unstable web tool was accepted in workflow")
	}
}
