package asset

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type Asset struct {
	ID        string         `json:"id"`
	Kind      string         `json:"kind"`
	MIMEType  string         `json:"mimeType"`
	FileName  string         `json:"fileName"`
	Path      string         `json:"path"`
	URL       string         `json:"url,omitempty"`
	Size      int64          `json:"size"`
	SHA256    string         `json:"sha256"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	CreatedAt time.Time      `json:"createdAt"`
}

type FileStore struct {
	rootDir string
	baseURL string
}

func NewFileStore(rootDir, baseURL string) (*FileStore, error) {
	rootDir = strings.TrimSpace(rootDir)
	if rootDir == "" {
		return nil, errors.New("asset root directory is required")
	}
	absolute, err := filepath.Abs(rootDir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(absolute, 0o755); err != nil {
		return nil, err
	}
	return &FileStore{rootDir: absolute, baseURL: strings.TrimRight(baseURL, "/")}, nil
}

func (s *FileStore) RootDir() string {
	if s == nil {
		return ""
	}
	return s.rootDir
}

func (s *FileStore) SaveJSON(ctx context.Context, kind, suggestedName string, payload any, metadata map[string]any) (*Asset, error) {
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return nil, err
	}
	if !strings.HasSuffix(strings.ToLower(suggestedName), ".json") {
		suggestedName += ".json"
	}
	return s.SaveBytes(ctx, kind, suggestedName, "application/json; charset=utf-8", data, metadata)
}

func (s *FileStore) SaveText(ctx context.Context, kind, suggestedName, mimeType, text string, metadata map[string]any) (*Asset, error) {
	return s.SaveBytes(ctx, kind, suggestedName, mimeType, []byte(text), metadata)
}

func (s *FileStore) SaveBytes(ctx context.Context, kind, suggestedName, mimeType string, data []byte, metadata map[string]any) (*Asset, error) {
	if s == nil {
		return nil, errors.New("asset store is nil")
	}
	if err := ctxErr(ctx); err != nil {
		return nil, err
	}
	kind = sanitizeSegment(kind)
	if kind == "" {
		kind = "asset"
	}
	if mimeType == "" {
		mimeType = mime.TypeByExtension(filepath.Ext(suggestedName))
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	id := newID()
	createdAt := time.Now().UTC()
	day := createdAt.Format("20060102")
	dir := filepath.Join(s.rootDir, kind, day)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	fileName := sanitizeFileName(suggestedName)
	if fileName == "" {
		fileName = kind + ".bin"
	}
	fileName = id + "-" + fileName
	path := filepath.Join(dir, fileName)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return nil, err
	}
	sum := sha256.Sum256(data)
	asset := &Asset{
		ID:        id,
		Kind:      kind,
		MIMEType:  mimeType,
		FileName:  fileName,
		Path:      path,
		Size:      int64(len(data)),
		SHA256:    hex.EncodeToString(sum[:]),
		Metadata:  cloneMetadata(metadata),
		CreatedAt: createdAt,
	}
	if s.baseURL != "" {
		relative, err := filepath.Rel(s.rootDir, path)
		if err == nil {
			asset.URL = s.baseURL + "/" + filepath.ToSlash(relative)
		}
	}
	return asset, nil
}

func (a Asset) Map() map[string]any {
	return map[string]any{
		"id":        a.ID,
		"kind":      a.Kind,
		"mimeType":  a.MIMEType,
		"fileName":  a.FileName,
		"path":      a.Path,
		"url":       a.URL,
		"size":      a.Size,
		"sha256":    a.SHA256,
		"metadata":  a.Metadata,
		"createdAt": a.CreatedAt.Format(time.RFC3339Nano),
	}
}

func ctxErr(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}

func cloneMetadata(in map[string]any) map[string]any {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

var unsafeSegment = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func sanitizeSegment(value string) string {
	value = strings.TrimSpace(value)
	value = strings.Trim(value, ".")
	value = unsafeSegment.ReplaceAllString(value, "-")
	return strings.Trim(value, "-")
}

func sanitizeFileName(value string) string {
	value = filepath.Base(strings.TrimSpace(value))
	value = strings.Trim(value, ".")
	value = unsafeSegment.ReplaceAllString(value, "-")
	return strings.Trim(value, "-")
}

func newID() string {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UTC().UnixNano())
	}
	return hex.EncodeToString(b[:])
}
