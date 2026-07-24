package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/flowcanvas/flowcanvas-backend-sdk/ai"
	"github.com/flowcanvas/flowcanvas-backend-sdk/asset"
	"github.com/flowcanvas/flowcanvas-backend-sdk/builtin"
	aiexec "github.com/flowcanvas/flowcanvas-backend-sdk/executors/ai"
	"github.com/flowcanvas/flowcanvas-backend-sdk/graph"
	"github.com/flowcanvas/flowcanvas-backend-sdk/runtime"
	sqlitestore "github.com/flowcanvas/flowcanvas-backend-sdk/storage/sqlite"
	"github.com/flowcanvas/flowcanvas-backend-sdk/transport"
	"github.com/flowcanvas/flowcanvas-backend-sdk/validator"
)

type check struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

func main() {
	checks := []check{}
	add := func(name, detail string, err error) {
		status := "PASS"
		if err != nil {
			status = "FAIL"
			detail = err.Error()
		}
		checks = append(checks, check{Name: name, Status: status, Detail: detail})
	}

	engine := builtin.NewDemoEngine()
	g := builtin.ExampleGraph()

	validate := validator.Validate(g, engine.Registry())
	if !validate.Valid {
		add("valid graph parses and validates", "", fmt.Errorf("%+v", validate.Issues))
	} else {
		add("valid graph parses and validates", fmt.Sprintf("nodes=%d edges=%d", len(g.Nodes), len(g.Edges)), nil)
	}

	for _, item := range []struct {
		kind string
		code string
	}{{"missing-port", validator.MissingSourcePort}, {"cycle", validator.CycleDetected}, {"missing-prompt", validator.NodeConfigurationInvalid}} {
		result := validator.Validate(builtin.BrokenGraph(item.kind), engine.Registry())
		add("invalid graph reports "+item.kind, item.code, expectIssue(result, item.code))
	}

	runResult, err := engine.RunGraph(context.Background(), g, runtime.RunOptions{StopOnError: true})
	if err != nil {
		add("runtime text -> image -> video", "", err)
	} else {
		_, hasVideo := runResult.Outputs["video-1"]["video"]
		if runResult.Status != runtime.StatusSucceeded || !hasVideo {
			add("runtime text -> image -> video", "", fmt.Errorf("status=%s outputs=%v", runResult.Status, runResult.Outputs))
		} else {
			add("runtime text -> image -> video", "status=succeeded video output present", nil)
		}
	}

	cancelGraph := builtin.ExampleGraph()
	for i := range cancelGraph.Nodes {
		cancelGraph.Nodes[i].Data["delayMs"] = 500
	}
	handle, err := engine.Run(context.Background(), cancelGraph, runtime.RunOptions{StopOnError: true})
	if err != nil {
		add("runtime cancel", "", err)
	} else {
		time.Sleep(50 * time.Millisecond)
		handle.Cancel()
		result, waitErr := handle.Wait(context.Background())
		if waitErr != nil {
			add("runtime cancel", "", waitErr)
		} else if result.Status != runtime.StatusCancelled {
			add("runtime cancel", "", fmt.Errorf("status=%s", result.Status))
		} else {
			add("runtime cancel", "status=cancelled", nil)
		}
	}

	server := httptest.NewServer(transport.NewServer(builtin.NewDemoEngine()).Handler())
	defer server.Close()
	body, _ := json.Marshal(map[string]any{"graph": g, "options": runtime.RunOptions{StopOnError: true}})
	resp, err := http.Post(server.URL+"/api/flow/run", "application/json", bytes.NewReader(body))
	if err != nil {
		add("HTTP run starts", "", err)
	} else {
		var started struct {
			RunID string `json:"runId"`
		}
		err = json.NewDecoder(resp.Body).Decode(&started)
		resp.Body.Close()
		if err != nil || resp.StatusCode != http.StatusAccepted || started.RunID == "" {
			add("HTTP run starts", "", fmt.Errorf("status=%d runId=%q err=%v", resp.StatusCode, started.RunID, err))
		} else {
			add("HTTP run starts", started.RunID, nil)
			add("SSE emits progress and completed", "", expectSSECompleted(server.URL, started.RunID))
		}
	}

	add("phase-2 AI executor + SQLite + assets + HTTP archive", "", expectPhase2LocalChain())

	allPass := true
	for _, c := range checks {
		if c.Status != "PASS" {
			allPass = false
		}
	}
	summary := map[string]any{
		"ok":     allPass,
		"checks": checks,
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(summary)
	if !allPass {
		os.Exit(1)
	}
}

func expectPhase2LocalChain() error {
	modelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.Error(w, "unexpected path", http.StatusNotFound)
			return
		}
		var req struct {
			Messages []ai.Message `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		system := ""
		if len(req.Messages) > 0 {
			system = req.Messages[0].Content
		}
		content := `{"text":"扩展后的短片故事","title":"故事"}`
		switch {
		case strings.Contains(system, "图片生成"):
			content = `{"prompt":"霓虹雨夜主视觉","aspectRatio":"16:9","resolution":"2K"}`
		case strings.Contains(system, "视频生成"):
			content = `{"prompt":"机器人穿街镜头","motion":"推进","durationSec":5,"timeline":[]}`
		case strings.Contains(system, "音频生成"):
			content = `{"audioType":"voiceover","voice":"warm","durationSec":5}`
		case strings.Contains(system, "镜头合成"):
			content = `{"title":"成片","tracks":[],"export":{"format":"mp4","resolution":"1080p"}}`
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"content": content}}},
		})
	}))
	defer modelServer.Close()

	tempDir, err := os.MkdirTemp("", "flowcanvas-phase2-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tempDir)

	store, err := sqlitestore.Open(filepath.Join(tempDir, "flowcanvas.db"))
	if err != nil {
		return err
	}
	defer store.Close()
	assetStore, err := asset.NewFileStore(filepath.Join(tempDir, "assets"), "")
	if err != nil {
		return err
	}
	client, err := ai.NewOpenAIClient(ai.Config{BaseURL: modelServer.URL, APIKey: "test", Model: "fake-flow-model", MaxRetries: 0})
	if err != nil {
		return err
	}
	engine := runtime.NewEngine(builtin.Registry(), runtime.WithRunObserver(store))
	if err := aiexec.RegisterExecutors(engine, aiexec.Config{Client: client, AssetStore: assetStore}); err != nil {
		return err
	}
	result, err := engine.RunGraph(context.Background(), builtin.ProductionGraph(), runtime.RunOptions{StopOnError: true})
	if err != nil {
		return err
	}
	if result.Status != runtime.StatusSucceeded {
		return fmt.Errorf("phase-2 run status=%s", result.Status)
	}
	if _, ok := result.Outputs["compose-1"]["output"]; !ok {
		return fmt.Errorf("missing compose output")
	}
	stored, err := store.GetStoredRun(context.Background(), result.RunID)
	if err != nil {
		return err
	}
	if stored.Result == nil || stored.Result.Status != runtime.StatusSucceeded {
		return fmt.Errorf("stored run incomplete")
	}
	events, err := store.Events(context.Background(), result.RunID, 0)
	if err != nil {
		return err
	}
	if len(events) < 10 {
		return fmt.Errorf("too few stored events: %d", len(events))
	}
	archiveServer := httptest.NewServer(transport.NewServerWithArchive(engine, store).Handler())
	defer archiveServer.Close()
	resp, err := http.Get(archiveServer.URL + "/api/flow/runs?limit=3")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("archive list status=%d", resp.StatusCode)
	}
	return nil
}

func expectIssue(result graph.ValidationResult, code string) error {
	if result.Valid {
		return fmt.Errorf("expected invalid graph")
	}
	for _, issue := range result.Issues {
		if issue.Code == code {
			return nil
		}
	}
	return fmt.Errorf("missing issue %s in %+v", code, result.Issues)
}

func expectSSECompleted(baseURL, runID string) error {
	resp, err := http.Get(baseURL + "/api/flow/runs/" + runID + "/events")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	reader := bufio.NewReader(resp.Body)
	deadline := time.Now().Add(5 * time.Second)
	seenProgress := false
	for time.Now().Before(deadline) {
		line, err := reader.ReadString('\n')
		if err != nil {
			return err
		}
		if strings.Contains(line, "node.progress") {
			seenProgress = true
		}
		if strings.Contains(line, "run.completed") {
			if !seenProgress {
				return fmt.Errorf("run.completed received before node.progress")
			}
			return nil
		}
	}
	return fmt.Errorf("timeout waiting for run.completed")
}
