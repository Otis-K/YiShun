package tmlabtasks

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/flowcanvas/flowcanvas-backend-sdk/models"
)

const (
	DefaultBaseURL        = "https://api.tmlab.store"
	NanoBananaProSpecial1 = "nano-banana-pro(特价版 1)"
)

var allowedSizes = map[string]bool{"1K": true, "2K": true, "4K": true}
var allowedRatios = map[string]bool{
	"auto": true, "1:1": true, "16:9": true, "9:16": true, "4:3": true, "3:4": true,
	"3:2": true, "2:3": true, "5:4": true, "4:5": true, "21:9": true,
}

type Config struct {
	BaseURL      string
	APIKey       string
	PollInterval time.Duration
	HTTPClient   *http.Client
}

type Client struct {
	baseURL string
	apiKey  string
	poll    time.Duration
	http    *http.Client
}

func New(config Config) (*Client, error) {
	base := strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	if base == "" {
		base = DefaultBaseURL
	}
	parsed, err := url.ParseRequestURI(base)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("invalid tmlab base url %q", base)
	}
	if strings.TrimSpace(config.APIKey) == "" {
		return nil, errors.New("tmlab API key is required")
	}
	poll := config.PollInterval
	if poll <= 0 {
		poll = 5 * time.Second
	}
	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 2 * time.Minute}
	}
	return &Client{baseURL: base, apiKey: strings.TrimSpace(config.APIKey), poll: poll, http: httpClient}, nil
}

func (c *Client) GenerateImage(ctx context.Context, request models.ImageRequest, emit models.ProgressFunc) (*models.ImageResult, error) {
	if request.Model != NanoBananaProSpecial1 {
		return nil, fmt.Errorf("unsupported tmlab tasks model: %s", request.Model)
	}
	size := strings.ToUpper(strings.TrimSpace(request.Size))
	if size == "" {
		size = "1K"
	}
	if !allowedSizes[size] {
		return nil, fmt.Errorf("unsupported image size %q", request.Size)
	}
	ratio := strings.TrimSpace(request.AspectRatio)
	if ratio == "" {
		ratio = "auto"
	}
	if !allowedRatios[ratio] {
		return nil, fmt.Errorf("unsupported aspect ratio %q", ratio)
	}
	payload := map[string]any{
		"model":    request.Model,
		"prompt":   request.Prompt,
		"size":     size,
		"metadata": map[string]any{"aspectRatio": ratio},
	}
	if len(request.Images) > 0 {
		payload["images"] = request.Images
	}
	for key, value := range request.Parameters {
		if _, reserved := payload[key]; !reserved {
			payload[key] = value
		}
	}
	emitProgress(emit, "submitting", 0.02, "正在提交图片生成任务")
	var created taskResponse
	if err := c.jsonRequest(ctx, http.MethodPost, "/v1/tasks", payload, &created); err != nil {
		return nil, err
	}
	taskID := firstNonEmpty(created.TaskID, created.ID)
	if taskID == "" {
		return nil, errors.New("tmlab create task response has no task id")
	}
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		var current taskResponse
		if err := c.jsonRequest(ctx, http.MethodGet, "/v1/tasks/"+url.PathEscape(taskID), nil, &current); err != nil {
			return nil, err
		}
		progress := clamp(current.Progress/100, 0, 1)
		emitProgress(emit, current.Status, progress, "图片生成中")
		switch strings.ToLower(current.Status) {
		case "completed", "succeeded", "success":
			resultURL := metadataURL(current.Metadata)
			if resultURL == "" {
				return nil, errors.New("completed tmlab task has no metadata.url")
			}
			content, contentType, err := c.download(ctx, taskID, resultURL)
			if err != nil {
				return nil, err
			}
			emitProgress(emit, "completed", 1, "图片生成完成")
			return &models.ImageResult{TaskID: taskID, Status: "completed", Progress: 1, URL: resultURL, ContentType: contentType, Content: content, Metadata: current.Metadata}, nil
		case "failed", "error", "cancelled":
			reason := firstNonEmpty(strings.TrimSpace(current.Error.Message), strings.TrimSpace(current.FailureReason), strings.TrimSpace(current.Message), nestedFailureReason(current.Data), nestedFailureReason(current.Metadata))
			if reason == "" {
				reason = "模型平台返回失败，但查询接口未提供失败原因"
			}
			return nil, fmt.Errorf("tmlab task %s failed: %s", taskID, reason)
		}
		if err := wait(ctx, c.poll); err != nil {
			return nil, err
		}
	}
}

type taskResponse struct {
	ID            string         `json:"id"`
	TaskID        string         `json:"task_id"`
	Status        string         `json:"status"`
	Progress      float64        `json:"progress"`
	Metadata      map[string]any `json:"metadata"`
	Data          map[string]any `json:"data"`
	FailureReason string         `json:"failure_reason"`
	Message       string         `json:"message"`
	Error         struct {
		Message string `json:"message"`
		Code    string `json:"code"`
	} `json:"error"`
}

func (c *Client) jsonRequest(ctx context.Context, method, endpoint string, payload any, output any) error {
	var encoded []byte
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		encoded = data
	}
	idempotencyKey := requestID()
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		var body io.Reader
		if encoded != nil {
			body = bytes.NewReader(encoded)
		}
		req, err := http.NewRequestWithContext(ctx, method, c.baseURL+endpoint, body)
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
		req.Header.Set("Accept", "application/json")
		if payload != nil {
			req.Header.Set("Content-Type", "application/json")
			// Reuse one key across retries so providers which support idempotency do
			// not create or bill duplicate generation tasks after a broken response.
			req.Header.Set("Idempotency-Key", idempotencyKey)
		}
		resp, err := c.http.Do(req)
		if err == nil {
			data, readErr := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
			resp.Body.Close()
			if readErr == nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
				if err := json.Unmarshal(data, output); err != nil {
					return fmt.Errorf("decode tmlab response: %w", err)
				}
				return nil
			}
			if readErr != nil {
				lastErr = readErr
			} else {
				lastErr = fmt.Errorf("tmlab returned HTTP %d: %s", resp.StatusCode, truncate(string(data), 2048))
				if resp.StatusCode < 500 && resp.StatusCode != http.StatusTooManyRequests {
					return lastErr
				}
			}
		} else {
			lastErr = err
		}
		if attempt == 2 || ctx.Err() != nil || !transientRequestError(lastErr) {
			break
		}
		if err := wait(ctx, time.Duration(attempt+1)*500*time.Millisecond); err != nil {
			return err
		}
	}
	return lastErr
}

func requestID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err == nil {
		return hex.EncodeToString(value[:])
	}
	return fmt.Sprintf("flowcanvas-%d", time.Now().UnixNano())
}

func transientRequestError(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	for _, marker := range []string{"eof", "connection reset", "broken pipe", "timeout", "temporarily unavailable", "http 429", "http 500", "http 502", "http 503", "http 504"} {
		if strings.Contains(text, marker) {
			return true
		}
	}
	return false
}

func (c *Client) download(ctx context.Context, taskID, resultURL string) ([]byte, string, error) {
	content, contentType, err := c.downloadURL(ctx, c.baseURL+"/v1/tasks/"+url.PathEscape(taskID)+"/content", true)
	if err == nil {
		return content, contentType, nil
	}
	content, contentType, fallbackErr := c.downloadURL(ctx, resultURL, false)
	if fallbackErr != nil {
		return nil, "", fmt.Errorf("download generated image: content endpoint: %v; result url: %w", err, fallbackErr)
	}
	return content, contentType, nil
}

func (c *Client) downloadURL(ctx context.Context, target string, authorize bool) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, "", err
	}
	if authorize {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return nil, "", err
	}
	if len(data) == 0 {
		return nil, "", errors.New("downloaded image is empty")
	}
	return data, strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0]), nil
}

func metadataURL(metadata map[string]any) string {
	if value, ok := metadata["url"].(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
func emitProgress(emit models.ProgressFunc, status string, progress float64, message string) {
	if emit != nil {
		emit(models.Progress{Status: status, Progress: progress, Message: message})
	}
}
func clamp(value, min, max float64) float64 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}
func wait(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "..."
}
