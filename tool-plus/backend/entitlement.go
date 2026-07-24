package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"
)

type authorizationRequest struct {
	IdempotencyKey       string `json:"idempotencyKey"`
	AccountToken         string `json:"accountToken,omitempty"`
	DeviceID             string `json:"deviceId"`
	AppVersion           string `json:"appVersion"`
	ToolKey              string `json:"toolKey"`
	WorkflowID           string `json:"workflowId,omitempty"`
	RunID                string `json:"runId,omitempty"`
	StepID               string `json:"stepId,omitempty"`
	Attempt              int    `json:"attempt"`
	InputCount           int    `json:"inputCount"`
	InputBytes           int64  `json:"inputBytes"`
	OptionsHash          string `json:"optionsHash"`
	RequestedConcurrency int    `json:"requestedConcurrency"`
}

type authorizationResponse struct {
	Allowed       bool               `json:"allowed"`
	Reason        string             `json:"reason,omitempty"`
	Permit        string             `json:"permit,omitempty"`
	ReservationID string             `json:"reservationId,omitempty"`
	Plan          string             `json:"plan,omitempty"`
	Limits        map[string]float64 `json:"limits,omitempty"`
	ExpiresAt     string             `json:"expiresAt,omitempty"`
}

type permitClaims struct {
	ToolKey     string `json:"toolKey"`
	RunID       string `json:"runId"`
	StepID      string `json:"stepId"`
	Attempt     int    `json:"attempt"`
	OptionsHash string `json:"optionsHash"`
	ExpiresAt   string `json:"expiresAt"`
}

type executionAuthorization struct {
	Remote         bool
	BaseURL        string
	ReservationID  string
	IdempotencyKey string
	Request        authorizationRequest
}

func authorizeExecution(req Request, tool Tool) (executionAuthorization, error) {
	inputBytes := int64(0)
	for _, input := range req.Inputs {
		if info, err := os.Stat(input); err == nil && info.Mode().IsRegular() {
			inputBytes += info.Size()
		}
	}
	attempt := req.Attempt
	if attempt < 1 {
		attempt = 1
	}
	runID := strings.TrimSpace(req.RunID)
	if runID == "" {
		runID = "single"
	}
	stepID := strings.TrimSpace(req.StepID)
	if stepID == "" {
		stepID = tool.Key
	}
	request := authorizationRequest{
		IdempotencyKey: fmt.Sprintf("%s:%s:%d", runID, stepID, attempt),
		AccountToken:   strings.TrimSpace(os.Getenv("TOOLPLUS_ACCOUNT_TOKEN")),
		DeviceID:       environmentDefault("TOOLPLUS_DEVICE_ID", "local-device"),
		AppVersion:     environmentDefault("TOOLPLUS_APP_VERSION", "0.5.20"),
		ToolKey:        tool.Key, WorkflowID: req.WorkflowID, RunID: runID, StepID: stepID, Attempt: attempt,
		InputCount: len(req.Inputs), InputBytes: inputBytes, OptionsHash: hashOptions(req.Options), RequestedConcurrency: 1,
	}
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("TOOLPLUS_ENTITLEMENT_URL")), "/")
	if baseURL == "" {
		if strings.EqualFold(tool.RequiredPlan, "free") || tool.RequiredPlan == "" {
			return executionAuthorization{Request: request, IdempotencyKey: request.IdempotencyKey}, nil
		}
		return executionAuthorization{}, errors.New("会员授权服务未配置，付费功能已安全阻断")
	}
	if tool.RequiredPlan != "free" && request.AccountToken == "" {
		return executionAuthorization{}, errors.New("需要登录并具备相应会员权益")
	}
	var response authorizationResponse
	var err error
	for attemptIndex := 0; attemptIndex < 2; attemptIndex++ {
		err = postEntitlementJSON(baseURL+"/v1/tool-executions/authorize", request, &response)
		if err == nil {
			break
		}
	}
	if err != nil {
		if strings.EqualFold(tool.RequiredPlan, "free") {
			return executionAuthorization{Request: request, IdempotencyKey: request.IdempotencyKey}, nil
		}
		return executionAuthorization{}, fmt.Errorf("会员授权服务不可达: %w", err)
	}
	if !response.Allowed {
		if response.Reason == "" {
			response.Reason = "当前账号无权执行此功能"
		}
		return executionAuthorization{}, errors.New(response.Reason)
	}
	if maxInputs := int(response.Limits["maxInputs"]); maxInputs > 0 && len(req.Inputs) > maxInputs {
		return executionAuthorization{}, fmt.Errorf("会员额度限制最多 %d 个输入", maxInputs)
	}
	if maxBytes := int64(response.Limits["maxBytes"]); maxBytes > 0 && inputBytes > maxBytes {
		return executionAuthorization{}, fmt.Errorf("会员额度限制最多 %d 字节输入", maxBytes)
	}
	secret := strings.TrimSpace(os.Getenv("TOOLPLUS_PERMIT_HMAC_SECRET"))
	if secret == "" {
		return executionAuthorization{}, errors.New("授权服务已启用，但本地许可验签密钥未配置")
	}
	if err := verifyPermit(response.Permit, secret, request); err != nil {
		return executionAuthorization{}, fmt.Errorf("服务器许可无效: %w", err)
	}
	return executionAuthorization{Remote: true, BaseURL: baseURL, ReservationID: response.ReservationID, IdempotencyKey: request.IdempotencyKey, Request: request}, nil
}

func settleExecution(auth executionAuthorization, response Response) {
	if !auth.Remote || auth.ReservationID == "" {
		return
	}
	status := "failed"
	if response.OK {
		status = "succeeded"
	}
	payload := map[string]any{
		"idempotencyKey": auth.IdempotencyKey, "reservationId": auth.ReservationID,
		"runId": auth.Request.RunID, "stepId": auth.Request.StepID, "attempt": auth.Request.Attempt,
		"status": status, "outputCount": len(response.Outputs), "inputCount": auth.Request.InputCount,
	}
	var ignored map[string]any
	_ = postEntitlementJSON(auth.BaseURL+"/v1/tool-executions/settle", payload, &ignored)
}

func postEntitlementJSON(url string, payload, result any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	request, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	limited := io.LimitReader(response.Body, 1024*1024)
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, limited)
		return fmt.Errorf("HTTP %d", response.StatusCode)
	}
	if err := json.NewDecoder(limited).Decode(result); err != nil {
		return err
	}
	return nil
}

func hashOptions(options map[string]string) string {
	keys := make([]string, 0, len(options))
	for key := range options {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	canonical := make([][2]string, 0, len(keys))
	for _, key := range keys {
		canonical = append(canonical, [2]string{key, options[key]})
	}
	data, _ := json.Marshal(canonical)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func verifyPermit(value, secret string, request authorizationRequest) error {
	parts := strings.Split(value, ".")
	if len(parts) != 2 {
		return errors.New("许可格式错误")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return errors.New("许可载荷编码错误")
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return errors.New("许可签名编码错误")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(parts[0]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return errors.New("许可签名不匹配")
	}
	var claims permitClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return errors.New("许可载荷无效")
	}
	expiresAt, err := time.Parse(time.RFC3339, claims.ExpiresAt)
	if err != nil || !expiresAt.After(time.Now()) {
		return errors.New("许可已过期")
	}
	if claims.ToolKey != request.ToolKey || claims.RunID != request.RunID || claims.StepID != request.StepID || claims.Attempt != request.Attempt || claims.OptionsHash != request.OptionsHash {
		return errors.New("许可绑定字段不匹配")
	}
	return nil
}

func signPermitForTest(claims permitClaims, secret string) string {
	payload, _ := json.Marshal(claims)
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(encoded))
	return encoded + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func environmentDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
