package asset

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestFileStoreSaveJSON(t *testing.T) {
	store, err := NewFileStore(t.TempDir(), "http://localhost/assets")
	if err != nil {
		t.Fatal(err)
	}
	asset, err := store.SaveJSON(context.Background(), "../image", "../unsafe name.json", map[string]any{"ok": true}, map[string]any{"nodeId": "n1"})
	if err != nil {
		t.Fatal(err)
	}
	if asset.ID == "" || asset.Kind != "image" || asset.Size == 0 || asset.SHA256 == "" {
		t.Fatalf("invalid asset: %+v", asset)
	}
	if !strings.Contains(asset.URL, "/image/") {
		t.Fatalf("expected public asset url, got %q", asset.URL)
	}
	if _, err := os.Stat(asset.Path); err != nil {
		t.Fatalf("asset not written: %v", err)
	}
	if strings.Contains(asset.FileName, "..") || strings.Contains(asset.FileName, "\\") {
		t.Fatalf("file name was not sanitized: %q", asset.FileName)
	}
}
