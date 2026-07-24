package aliyunoss

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"
)

const defaultSignedURLTTL = 2 * time.Hour

type Config struct {
	Endpoint        string
	AccessKeyID     string
	AccessKeySecret string
	Bucket          string
	Prefix          string
	SignedURLTTL    time.Duration
}

type LocalAsset struct {
	Path     string `json:"path"`
	Name     string `json:"name,omitempty"`
	Kind     string `json:"kind"`
	MimeType string `json:"mimeType,omitempty"`
	Role     string `json:"role,omitempty"`
}

type UploadedAsset struct {
	ObjectKey string `json:"objectKey"`
	URL       string `json:"url"`
	Kind      string `json:"kind"`
	Role      string `json:"role,omitempty"`
	MimeType  string `json:"mimeType,omitempty"`
	Size      int64  `json:"size"`
}

type Client struct {
	bucket *oss.Bucket
	prefix string
	ttl    time.Duration
}

func New(config Config) (*Client, error) {
	endpoint := strings.TrimSpace(config.Endpoint)
	if endpoint == "" {
		return nil, errors.New("FLOWCANVAS_OSS_ENDPOINT is required")
	}
	if !strings.HasPrefix(endpoint, "https://") && !strings.HasPrefix(endpoint, "http://") {
		endpoint = "https://" + endpoint
	}
	if strings.TrimSpace(config.AccessKeyID) == "" || strings.TrimSpace(config.AccessKeySecret) == "" {
		return nil, errors.New("FLOWCANVAS_OSS_ACCESS_KEY_ID and FLOWCANVAS_OSS_ACCESS_KEY_SECRET are required")
	}
	if strings.TrimSpace(config.Bucket) == "" {
		return nil, errors.New("FLOWCANVAS_OSS_BUCKET is required")
	}
	sdk, err := oss.New(endpoint, strings.TrimSpace(config.AccessKeyID), strings.TrimSpace(config.AccessKeySecret))
	if err != nil {
		return nil, fmt.Errorf("create Aliyun OSS client: %w", err)
	}
	bucket, err := sdk.Bucket(strings.TrimSpace(config.Bucket))
	if err != nil {
		return nil, fmt.Errorf("open Aliyun OSS bucket: %w", err)
	}
	ttl := config.SignedURLTTL
	if ttl <= 0 {
		ttl = defaultSignedURLTTL
	}
	return &Client{bucket: bucket, prefix: normalizePrefix(config.Prefix), ttl: ttl}, nil
}

func (c *Client) Upload(ctx context.Context, asset LocalAsset) (*UploadedAsset, error) {
	if c == nil || c.bucket == nil {
		return nil, errors.New("Aliyun OSS client is not configured")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	kind := strings.ToLower(strings.TrimSpace(asset.Kind))
	if kind != "image" && kind != "video" && kind != "audio" {
		return nil, fmt.Errorf("unsupported local asset kind %q", asset.Kind)
	}
	path := strings.TrimSpace(asset.Path)
	if path == "" || !filepath.IsAbs(path) {
		return nil, errors.New("local asset path must be absolute")
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("stat local asset: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 {
		return nil, errors.New("local asset must be a non-empty regular file")
	}
	if info.Size() > maxAssetBytes(kind) {
		return nil, fmt.Errorf("%s asset exceeds %d MiB limit", kind, maxAssetBytes(kind)>>20)
	}
	mimeType := strings.TrimSpace(asset.MimeType)
	if mimeType == "" {
		mimeType = mime.TypeByExtension(strings.ToLower(filepath.Ext(path)))
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	if !strings.HasPrefix(strings.ToLower(mimeType), kind+"/") {
		return nil, fmt.Errorf("asset MIME type %q does not match kind %q", mimeType, kind)
	}
	key, err := c.objectKey(kind, asset.Name, path)
	if err != nil {
		return nil, err
	}
	if err := c.bucket.PutObjectFromFile(key, path, oss.ContentType(mimeType)); err != nil {
		return nil, fmt.Errorf("upload local asset to OSS: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	signedURL, err := c.bucket.SignURL(key, oss.HTTPGet, int64(c.ttl/time.Second))
	if err != nil {
		return nil, fmt.Errorf("sign OSS read URL: %w", err)
	}
	return &UploadedAsset{ObjectKey: key, URL: signedURL, Kind: kind, Role: strings.TrimSpace(asset.Role), MimeType: mimeType, Size: info.Size()}, nil
}

func (c *Client) objectKey(kind, name, path string) (string, error) {
	random := make([]byte, 12)
	if _, err := rand.Read(random); err != nil {
		return "", fmt.Errorf("create OSS object id: %w", err)
	}
	extension := strings.ToLower(filepath.Ext(name))
	if extension == "" {
		extension = strings.ToLower(filepath.Ext(path))
	}
	if len(extension) > 12 || strings.ContainsAny(extension, `/\\`) {
		extension = ""
	}
	date := time.Now().UTC().Format("2006/01/02")
	return c.prefix + "canvas-assets/" + kind + "/" + date + "/" + hex.EncodeToString(random) + extension, nil
}

func normalizePrefix(value string) string {
	value = strings.Trim(strings.ReplaceAll(strings.TrimSpace(value), "\\", "/"), "/")
	if value == "" {
		value = "mm-agent/tool-plus"
	}
	return value + "/"
}

func maxAssetBytes(kind string) int64 {
	switch kind {
	case "image":
		return 25 << 20
	case "audio":
		return 50 << 20
	default:
		return 500 << 20
	}
}
