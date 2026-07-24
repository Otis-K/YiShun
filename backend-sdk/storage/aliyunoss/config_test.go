package aliyunoss

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadConfigUsesJSONAndEnvironmentFallback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "flowcanvas-oss.json")
	data := []byte(`{
  "endpoint": "https://oss-config.example.com",
  "accessKeyId": "file-id",
  "accessKeySecret": "file-secret",
  "bucket": "file-bucket",
  "signedUrlTtlSeconds": 900
}`)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(configFileEnvironment, path)
	t.Setenv("FLOWCANVAS_OSS_ENDPOINT", "https://oss-env.example.com")
	t.Setenv("FLOWCANVAS_OSS_ACCESS_KEY_ID", "env-id")
	t.Setenv("FLOWCANVAS_OSS_ACCESS_KEY_SECRET", "env-secret")
	t.Setenv("FLOWCANVAS_OSS_BUCKET", "env-bucket")
	t.Setenv("FLOWCANVAS_OSS_PREFIX", "env-prefix")

	config, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if config.Endpoint != "https://oss-config.example.com" || config.AccessKeyID != "file-id" || config.AccessKeySecret != "file-secret" || config.Bucket != "file-bucket" || config.Prefix != "env-prefix" {
		t.Fatalf("unexpected file config: %+v", config)
	}
	if config.SignedURLTTL != 15*time.Minute {
		t.Fatalf("unexpected ttl: %s", config.SignedURLTTL)
	}
}

func TestLoadConfigRejectsInvalidExplicitFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "broken.json")
	if err := os.WriteFile(path, []byte(`{"endpoint":`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(configFileEnvironment, path)
	if _, err := LoadConfig(); err == nil {
		t.Fatal("expected invalid JSON error")
	}
}
