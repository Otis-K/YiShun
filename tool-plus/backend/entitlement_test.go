package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestAuthorizationBindsPermitAndSettlesWithoutPaths(t *testing.T) {
	secret := "test-only-secret"
	var authorizeCalls atomic.Int32
	var settleCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/tool-executions/authorize":
			authorizeCalls.Add(1)
			var request authorizationRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Error(err)
				w.WriteHeader(400)
				return
			}
			encoded, _ := json.Marshal(request)
			if strings.Contains(string(encoded), "secret-name.txt") || strings.Contains(string(encoded), `C:\\`) {
				t.Errorf("authorization leaked a path: %s", encoded)
			}
			claims := permitClaims{ToolKey: request.ToolKey, RunID: request.RunID, StepID: request.StepID, Attempt: request.Attempt, OptionsHash: request.OptionsHash, ExpiresAt: time.Now().Add(time.Minute).UTC().Format(time.RFC3339)}
			_ = json.NewEncoder(w).Encode(authorizationResponse{Allowed: true, Permit: signPermitForTest(claims, secret), ReservationID: "reservation-1", Limits: map[string]float64{"maxInputs": 2, "maxBytes": 1024}})
		case "/v1/tool-executions/settle":
			settleCalls.Add(1)
			var payload map[string]any
			_ = json.NewDecoder(r.Body).Decode(&payload)
			if payload["reservationId"] != "reservation-1" || payload["status"] != "succeeded" {
				t.Errorf("bad settle: %+v", payload)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	t.Setenv("TOOLPLUS_ENTITLEMENT_URL", server.URL)
	t.Setenv("TOOLPLUS_PERMIT_HMAC_SECRET", secret)
	t.Setenv("TOOLPLUS_ACCOUNT_TOKEN", "account-token-must-not-be-logged")

	root := t.TempDir()
	input := filepath.Join(root, "secret-name.txt")
	if err := os.WriteFile(input, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	request := Request{Tool: "markdown-to-html", Inputs: []string{input}, Options: map[string]string{"mode": "safe"}, RunID: "run-1", StepID: "step-1", Attempt: 1}
	authorization, err := authorizeExecution(request, Tool{Key: request.Tool, RequiredPlan: "pro"})
	if err != nil {
		t.Fatal(err)
	}
	settleExecution(authorization, Response{OK: true, Outputs: []string{"not-sent-to-server.html"}})
	if authorizeCalls.Load() != 1 || settleCalls.Load() != 1 {
		t.Fatalf("authorize=%d settle=%d", authorizeCalls.Load(), settleCalls.Load())
	}
}

func TestAuthorizationFailsClosedForPaidAndAllowsFreeOffline(t *testing.T) {
	t.Setenv("TOOLPLUS_ENTITLEMENT_URL", "")
	request := Request{Tool: "markdown-to-html", Options: map[string]string{}}
	if _, err := authorizeExecution(request, Tool{Key: request.Tool, RequiredPlan: "pro"}); err == nil {
		t.Fatal("paid tool was allowed without service")
	}
	if _, err := authorizeExecution(request, Tool{Key: request.Tool, RequiredPlan: "free"}); err != nil {
		t.Fatal(err)
	}
}

func TestAuthorizationRejectsTamperedPermit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(authorizationResponse{Allowed: true, Permit: "broken.permit", ReservationID: "reservation"})
	}))
	defer server.Close()
	t.Setenv("TOOLPLUS_ENTITLEMENT_URL", server.URL)
	t.Setenv("TOOLPLUS_PERMIT_HMAC_SECRET", "expected-secret")
	t.Setenv("TOOLPLUS_ACCOUNT_TOKEN", "test-account")
	_, err := authorizeExecution(Request{Tool: "markdown-to-html", Options: map[string]string{}}, Tool{Key: "markdown-to-html", RequiredPlan: "pro"})
	if err == nil || !strings.Contains(err.Error(), "许可") {
		t.Fatalf("unexpected error: %v", err)
	}
}
