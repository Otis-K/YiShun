package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: toolplus-backend catalog|run|workflow|serve")
		os.Exit(2)
	}
	switch os.Args[1] {
	case "catalog":
		writeJSON(ResponseCatalog{OK: true, Tools: catalog})
	case "init-output":
		writeJSON(runEngineCommand("init-output", nil))
	case "run":
		var req Request
		if err := json.NewDecoder(os.Stdin).Decode(&req); err != nil {
			writeJSON(Response{OK: false, Error: err.Error()})
			return
		}
		writeJSON(dispatch(req))
	case "workflow":
		var req WorkflowCommand
		if err := json.NewDecoder(os.Stdin).Decode(&req); err != nil {
			writeJSON(WorkflowResponse{OK: false, Error: err.Error()})
			return
		}
		writeJSON(handleWorkflowCommand(req))
	case "serve":
		serve()
	default:
		fmt.Fprintln(os.Stderr, "usage: toolplus-backend catalog|run|workflow|serve")
		os.Exit(2)
	}
}

func writeJSON(value any) {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	_ = encoder.Encode(value)
}

func serve() {
	http.HandleFunc("/catalog", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(ResponseCatalog{OK: true, Tools: catalog})
	})
	http.HandleFunc("/run", func(w http.ResponseWriter, r *http.Request) {
		var req Request
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			_ = json.NewEncoder(w).Encode(Response{OK: false, Error: err.Error()})
			return
		}
		_ = json.NewEncoder(w).Encode(dispatch(req))
	})
	_ = http.ListenAndServe("127.0.0.1:38177", nil)
}
