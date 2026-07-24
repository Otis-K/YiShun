package transport_test

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/flowcanvas/flowcanvas-backend-sdk/builtin"
	"github.com/flowcanvas/flowcanvas-backend-sdk/transport"
)

func TestHTTPValidateRunAndSSE(t *testing.T) {
	server := httptest.NewServer(transport.NewServer(builtin.NewDemoEngine()).Handler())
	defer server.Close()

	graphBody, _ := json.Marshal(map[string]any{"graph": builtin.ExampleGraph()})
	validate, err := http.Post(server.URL+"/api/flow/validate", "application/json", bytes.NewReader(graphBody))
	if err != nil {
		t.Fatal(err)
	}
	defer validate.Body.Close()
	if validate.StatusCode != http.StatusOK {
		t.Fatalf("validate status: %d", validate.StatusCode)
	}

	run, err := http.Post(server.URL+"/api/flow/run", "application/json", bytes.NewReader(graphBody))
	if err != nil {
		t.Fatal(err)
	}
	defer run.Body.Close()
	if run.StatusCode != http.StatusAccepted {
		t.Fatalf("run status: %d", run.StatusCode)
	}
	var started struct {
		RunID string `json:"runId"`
	}
	if err := json.NewDecoder(run.Body).Decode(&started); err != nil {
		t.Fatal(err)
	}
	if started.RunID == "" {
		t.Fatalf("runId empty")
	}

	stream, err := http.Get(server.URL + "/api/flow/runs/" + started.RunID + "/events")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	reader := bufio.NewReader(stream.Body)
	deadline := time.Now().Add(5 * time.Second)
	seenCompleted := false
	for time.Now().Before(deadline) {
		line, err := reader.ReadString('\n')
		if err != nil {
			break
		}
		if strings.Contains(line, "run.completed") {
			seenCompleted = true
			break
		}
	}
	if !seenCompleted {
		t.Fatalf("did not receive run.completed event")
	}
}
