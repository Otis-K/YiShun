package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const DefaultBaseURL = "https://api.tmlab.store"
const DefaultModel = "gpt-4o-mini"

type Config struct {
	BaseURL    string
	APIKey     string
	Model      string
	Timeout    time.Duration
	MaxRetries int
	Headers    map[string]string
	HTTPClient *http.Client
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatOptions struct {
	Temperature *float64 `json:"temperature,omitempty"`
	MaxTokens   *int     `json:"max_tokens,omitempty"`
	JSONMode    bool     `json:"-"`
}

type ChatResult struct {
	Content string         `json:"content"`
	Raw     map[string]any `json:"raw,omitempty"`
}

type OpenAIClient struct {
	config Config
	client *http.Client
}

func ConfigFromEnv() Config {
	timeout := 90 * time.Second
	if value := strings.TrimSpace(os.Getenv("FLOWCANVAS_AI_TIMEOUT_SECONDS")); value != "" {
		if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
			timeout = time.Duration(seconds) * time.Second
		}
	}
	maxRetries := 2
	if value := strings.TrimSpace(os.Getenv("FLOWCANVAS_AI_MAX_RETRIES")); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed >= 0 {
			maxRetries = parsed
		}
	}
	return Config{
		BaseURL:    firstEnv("FLOWCANVAS_AI_BASE_URL", "TMLAB_BASE_URL", "ZAPI_BASE_URL", "OPENAI_BASE_URL", DefaultBaseURL),
		APIKey:     firstEnv("FLOWCANVAS_AI_API_KEY", "TMLAB_API_KEY", "ZAPI_API_KEY", "OPENAI_API_KEY", ""),
		Model:      firstEnv("FLOWCANVAS_AI_MODEL", "TMLAB_MODEL", "ZAPI_MODEL", "OPENAI_MODEL", DefaultModel),
		Timeout:    timeout,
		MaxRetries: maxRetries,
	}
}

func NewOpenAIClient(config Config) (*OpenAIClient, error) {
	if strings.TrimSpace(config.BaseURL) == "" {
		config.BaseURL = DefaultBaseURL
	}
	if strings.TrimSpace(config.Model) == "" {
		config.Model = DefaultModel
	}
	if config.Timeout <= 0 {
		config.Timeout = 90 * time.Second
	}
	if config.MaxRetries < 0 {
		config.MaxRetries = 0
	}
	if _, err := url.ParseRequestURI(config.BaseURL); err != nil {
		return nil, fmt.Errorf("invalid AI base url %q: %w", config.BaseURL, err)
	}
	client := config.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: config.Timeout}
	}
	return &OpenAIClient{config: config, client: client}, nil
}

func (c *OpenAIClient) Config() Config {
	if c == nil {
		return Config{}
	}
	return c.config
}

func (c *OpenAIClient) Chat(ctx context.Context, messages []Message, options ChatOptions) (*ChatResult, error) {
	if c == nil {
		return nil, errors.New("AI client is nil")
	}
	if len(messages) == 0 {
		return nil, errors.New("messages are required")
	}
	payload := map[string]any{
		"model":    c.config.Model,
		"messages": messages,
	}
	if options.Temperature != nil {
		payload["temperature"] = *options.Temperature
	}
	if options.MaxTokens != nil {
		payload["max_tokens"] = *options.MaxTokens
	}
	if options.JSONMode {
		payload["response_format"] = map[string]any{"type": "json_object"}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	var lastErr error
	for attempt := 0; attempt <= c.config.MaxRetries; attempt++ {
		if attempt > 0 {
			if err := sleepWithContext(ctx, time.Duration(attempt)*500*time.Millisecond); err != nil {
				return nil, err
			}
		}
		result, err := c.chatOnce(ctx, body)
		if err == nil {
			return result, nil
		}
		lastErr = err
		if !retryable(err) {
			break
		}
	}
	return nil, lastErr
}

func (c *OpenAIClient) GenerateJSON(ctx context.Context, systemPrompt, userPrompt string) (map[string]any, string, error) {
	temp := 0.2
	maxTokens := 1200
	result, err := c.Chat(ctx, []Message{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: userPrompt},
	}, ChatOptions{Temperature: &temp, MaxTokens: &maxTokens, JSONMode: true})
	if err != nil {
		return nil, "", err
	}
	parsed, err := ParseJSONObject(result.Content)
	if err != nil {
		return nil, result.Content, err
	}
	return parsed, result.Content, nil
}

func (c *OpenAIClient) chatOnce(ctx context.Context, body []byte) (*ChatResult, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.chatCompletionsURL(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.config.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
	}
	for k, v := range c.config.Headers {
		req.Header.Set(k, v)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, httpStatusError{StatusCode: resp.StatusCode, Body: truncate(string(data), 2048)}
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("decode chat completion response: %w", err)
	}
	content, err := firstAssistantContent(raw)
	if err != nil {
		return nil, err
	}
	return &ChatResult{Content: content, Raw: raw}, nil
}

func (c *OpenAIClient) chatCompletionsURL() string {
	base := strings.TrimRight(c.config.BaseURL, "/")
	lower := strings.ToLower(base)
	switch {
	case strings.HasSuffix(lower, "/chat/completions"):
		return base
	case strings.HasSuffix(lower, "/v1"):
		return base + "/chat/completions"
	default:
		return base + "/v1/chat/completions"
	}
}

type httpStatusError struct {
	StatusCode int
	Body       string
}

func (e httpStatusError) Error() string {
	return fmt.Sprintf("AI provider returned HTTP %d: %s", e.StatusCode, e.Body)
}

func retryable(err error) bool {
	var status httpStatusError
	if errors.As(err, &status) {
		return status.StatusCode == http.StatusTooManyRequests || status.StatusCode >= 500
	}
	return true
}

func ParseJSONObject(content string) (map[string]any, error) {
	content = strings.TrimSpace(content)
	var out map[string]any
	if err := json.Unmarshal([]byte(content), &out); err == nil {
		return out, nil
	}
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start < 0 || end <= start {
		return nil, fmt.Errorf("AI response is not a JSON object: %s", truncate(content, 512))
	}
	if err := json.Unmarshal([]byte(content[start:end+1]), &out); err != nil {
		return nil, fmt.Errorf("parse JSON object from AI response: %w; content=%s", err, truncate(content, 512))
	}
	return out, nil
}

func firstAssistantContent(raw map[string]any) (string, error) {
	choices, ok := raw["choices"].([]any)
	if !ok || len(choices) == 0 {
		return "", errors.New("chat completion response has no choices")
	}
	first, ok := choices[0].(map[string]any)
	if !ok {
		return "", errors.New("chat completion choice is invalid")
	}
	message, ok := first["message"].(map[string]any)
	if !ok {
		return "", errors.New("chat completion choice has no message")
	}
	content, ok := message["content"].(string)
	if !ok || strings.TrimSpace(content) == "" {
		return "", errors.New("chat completion message content is empty")
	}
	return content, nil
}

func firstEnv(keys ...string) string {
	fallback := ""
	if len(keys) > 0 {
		fallback = keys[len(keys)-1]
		keys = keys[:len(keys)-1]
	}
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return fallback
}

func sleepWithContext(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max] + "..."
}
