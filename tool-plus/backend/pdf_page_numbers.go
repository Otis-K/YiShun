package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func runPDFPageNumbers(req Request) Response {
	helper, err := pdfPageNumbersHelperPath()
	if err != nil {
		return Response{OK: false, Error: err.Error()}
	}
	payload, err := json.Marshal(req)
	if err != nil {
		return Response{OK: false, Error: err.Error()}
	}
	cmd := exec.Command(helper)
	cmd.Env = pdfPageNumbersHelperEnvironment(os.Environ())
	cmd.Stdin = bytes.NewReader(payload)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()
	if runErr != nil && stdout.Len() == 0 {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = runErr.Error()
		}
		return Response{OK: false, Error: message}
	}
	var response Response
	if err := json.Unmarshal(stdout.Bytes(), &response); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message != "" {
			return Response{OK: false, Error: message}
		}
		return Response{OK: false, Error: err.Error()}
	}
	return response
}

func pdfPageNumbersHelperEnvironment(current []string) []string {
	values := engineEnvironment(current)
	filtered := values[:0]
	for _, entry := range values {
		name, _, found := strings.Cut(entry, "=")
		if found && (strings.EqualFold(name, "PYTHONUTF8") || strings.EqualFold(name, "PYTHONIOENCODING")) {
			continue
		}
		filtered = append(filtered, entry)
	}
	return append(filtered, "PYTHONUTF8=1", "PYTHONIOENCODING=utf-8")
}

func pdfPageNumbersHelperPath() (string, error) {
	base := filepath.Dir(os.Args[0])
	candidates := []string{
		filepath.Join(base, "pdf-page-numbers-helper.exe"),
		filepath.Join(base, "bin", "pdf-page-numbers-helper.exe"),
		filepath.Join("bin", "pdf-page-numbers-helper.exe"),
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", errors.New("PDF page numbers helper not found")
}
