package main

import (
	"strings"
	"testing"
)

func TestEngineEnvironmentPreservesProxyAndBypassesLocalhost(t *testing.T) {
	environment := engineEnvironment([]string{
		"HTTP_PROXY=http://proxy.example:8080",
		"no_proxy=internal.example,localhost",
		"PATH=C:\\bin",
	})
	joined := strings.Join(environment, "\n")
	if !strings.Contains(joined, "HTTP_PROXY=http://proxy.example:8080") {
		t.Fatal("HTTP proxy must be preserved")
	}
	if strings.Count(strings.ToUpper(joined), "NO_PROXY=") != 1 {
		t.Fatalf("expected exactly one NO_PROXY entry: %s", joined)
	}
	for _, host := range []string{"localhost", "127.0.0.1", "::1", "internal.example"} {
		if !strings.Contains(joined, host) {
			t.Fatalf("missing bypass host %s: %s", host, joined)
		}
	}
}
