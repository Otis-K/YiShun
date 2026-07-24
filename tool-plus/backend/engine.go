package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func runEngine(req Request) Response {
	return runEngineCommand("run", &req)
}

func runEngineCommand(command string, req *Request) Response {
	engine, err := enginePath()
	if err != nil {
		return Response{OK: false, Error: err.Error()}
	}
	timeout := 300 * time.Second
	if req != nil {
		if tool, ok := findTool(req.Tool); ok && tool.TimeoutSeconds > 0 {
			timeout = time.Duration(tool.TimeoutSeconds) * time.Second
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, engine, command)
	cmd.Env = engineEnvironment(os.Environ())
	if req != nil {
		payload, marshalErr := json.Marshal(req)
		if marshalErr != nil {
			return Response{OK: false, Error: marshalErr.Error()}
		}
		cmd.Stdin = bytes.NewReader(payload)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil && stdout.Len() == 0 {
		if ctx.Err() == context.DeadlineExceeded {
			return Response{OK: false, Error: fmt.Sprintf("processing engine timed out after %.0f seconds", timeout.Seconds())}
		}
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return Response{OK: false, Error: message}
	}
	if ctx.Err() == context.DeadlineExceeded {
		return Response{OK: false, Error: fmt.Sprintf("processing engine timed out after %.0f seconds", timeout.Seconds())}
	}
	var response Response
	if err := json.Unmarshal(stdout.Bytes(), &response); err != nil {
		return Response{OK: false, Error: err.Error()}
	}
	return response
}

func engineEnvironment(current []string) []string {
	values := make([]string, 0, len(current)+1)
	bypass := []string{"localhost", "127.0.0.1", "::1"}
	for _, entry := range current {
		name, value, found := strings.Cut(entry, "=")
		if found && strings.EqualFold(name, "NO_PROXY") {
			for _, item := range strings.Split(value, ",") {
				item = strings.TrimSpace(item)
				if item != "" {
					bypass = append(bypass, item)
				}
			}
			continue
		}
		values = append(values, entry)
	}
	seen := make(map[string]bool)
	unique := make([]string, 0, len(bypass))
	for _, value := range bypass {
		key := strings.ToLower(value)
		if !seen[key] {
			seen[key] = true
			unique = append(unique, value)
		}
	}
	return append(values, "NO_PROXY="+strings.Join(unique, ","))
}

func enginePath() (string, error) {
	base := filepath.Dir(os.Args[0])
	candidates := []string{
		filepath.Join(base, "toolplus-engine.exe"),
		filepath.Join(base, "bin", "toolplus-engine.exe"),
		filepath.Join("bin", "toolplus-engine.exe"),
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", errors.New("toolplus processing engine not found")
}
