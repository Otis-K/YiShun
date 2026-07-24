package aliyunoss

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const configFileEnvironment = "FLOWCANVAS_OSS_CONFIG_FILE"

type fileConfig struct {
	Endpoint            string `json:"endpoint"`
	AccessKeyID         string `json:"accessKeyId"`
	AccessKeySecret     string `json:"accessKeySecret"`
	Bucket              string `json:"bucket"`
	Prefix              string `json:"prefix"`
	SignedURLTTLSeconds int64  `json:"signedUrlTtlSeconds"`
}

// LoadConfig reads the per-user JSON file first and falls back to the existing
// environment variables for fields that are not present in the file.
func LoadConfig() (Config, error) {
	config := configFromEnvironment()
	path, explicit, err := configFilePath()
	if err != nil {
		return Config{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) && !explicit {
			return config, nil
		}
		return Config{}, fmt.Errorf("read OSS config file %q: %w", path, err)
	}
	var stored fileConfig
	if err := json.Unmarshal(data, &stored); err != nil {
		return Config{}, fmt.Errorf("parse OSS config file %q: %w", path, err)
	}
	if value := strings.TrimSpace(stored.Endpoint); value != "" {
		config.Endpoint = value
	}
	if value := strings.TrimSpace(stored.AccessKeyID); value != "" {
		config.AccessKeyID = value
	}
	if value := strings.TrimSpace(stored.AccessKeySecret); value != "" {
		config.AccessKeySecret = value
	}
	if value := strings.TrimSpace(stored.Bucket); value != "" {
		config.Bucket = value
	}
	if value := strings.TrimSpace(stored.Prefix); value != "" {
		config.Prefix = value
	}
	if stored.SignedURLTTLSeconds > 0 {
		config.SignedURLTTL = time.Duration(stored.SignedURLTTLSeconds) * time.Second
	}
	return config, nil
}

func configFilePath() (string, bool, error) {
	if path := strings.TrimSpace(os.Getenv(configFileEnvironment)); path != "" {
		return filepath.Clean(path), true, nil
	}
	directory, err := os.UserConfigDir()
	if err != nil {
		return "", false, fmt.Errorf("resolve user config directory: %w", err)
	}
	return filepath.Join(directory, "tool-plus", "flowcanvas-oss.json"), false, nil
}

func configFromEnvironment() Config {
	ttl := 2 * time.Hour
	if seconds, err := strconv.ParseInt(strings.TrimSpace(os.Getenv("FLOWCANVAS_OSS_SIGNED_URL_TTL_SECONDS")), 10, 64); err == nil && seconds > 0 {
		ttl = time.Duration(seconds) * time.Second
	}
	return Config{
		Endpoint:        os.Getenv("FLOWCANVAS_OSS_ENDPOINT"),
		AccessKeyID:     os.Getenv("FLOWCANVAS_OSS_ACCESS_KEY_ID"),
		AccessKeySecret: os.Getenv("FLOWCANVAS_OSS_ACCESS_KEY_SECRET"),
		Bucket:          os.Getenv("FLOWCANVAS_OSS_BUCKET"),
		Prefix:          os.Getenv("FLOWCANVAS_OSS_PREFIX"),
		SignedURLTTL:    ttl,
	}
}
