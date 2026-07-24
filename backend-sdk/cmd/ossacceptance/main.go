package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/flowcanvas/flowcanvas-backend-sdk/storage/aliyunoss"
)

func main() {
	file := flag.String("file", "", "absolute test asset path")
	kind := flag.String("kind", "image", "image, video, or audio")
	mimeType := flag.String("mime", "", "optional MIME type")
	flag.Parse()
	result, err := run(*file, *kind, *mimeType)
	if err != nil {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": false, "error": err.Error()})
		os.Exit(1)
	}
	_ = json.NewEncoder(os.Stdout).Encode(result)
}

func run(path, kind, mimeType string) (map[string]any, error) {
	if !filepath.IsAbs(path) {
		return nil, errors.New("-file must be absolute")
	}
	config, err := aliyunoss.LoadConfig()
	if err != nil {
		return nil, err
	}
	uploader, err := aliyunoss.New(config)
	if err != nil {
		return nil, err
	}
	original, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	uploaded, err := uploader.Upload(context.Background(), aliyunoss.LocalAsset{Path: path, Name: filepath.Base(path), Kind: kind, MimeType: mimeType, Role: "acceptance"})
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequest(http.MethodGet, uploaded.URL, nil)
	if err != nil {
		return nil, err
	}
	response, err := (&http.Client{Timeout: 2 * time.Minute}).Do(request)
	if err != nil {
		return nil, fmt.Errorf("download signed OSS URL: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download signed OSS URL: HTTP %d", response.StatusCode)
	}
	downloaded, err := io.ReadAll(io.LimitReader(response.Body, 600<<20))
	if err != nil {
		return nil, err
	}
	originalHash := sha256.Sum256(original)
	downloadedHash := sha256.Sum256(downloaded)
	if originalHash != downloadedHash {
		return nil, errors.New("downloaded OSS content hash does not match source")
	}
	parsed, _ := url.Parse(uploaded.URL)
	return map[string]any{
		"ok": true, "bucketHost": parsed.Host, "kind": uploaded.Kind, "bytes": uploaded.Size,
		"objectPrefixValid": strings.HasPrefix(uploaded.ObjectKey, strings.Trim(strings.ReplaceAll(config.Prefix, "\\", "/"), "/")+"/"),
		"sha256":            hex.EncodeToString(originalHash[:]), "signedDownload": true,
	}, nil
}
