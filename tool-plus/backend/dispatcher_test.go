package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func officeLimitFixture(t *testing.T, extension string, sheets, slides, media int, mediaBytes int64) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "fixture"+extension)
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	add := func(name string, size int64) {
		t.Helper()
		entry, createErr := archive.Create(name)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if size > 0 {
			if _, copyErr := io.Copy(entry, bytes.NewReader(bytes.Repeat([]byte{'x'}, int(size)))); copyErr != nil {
				t.Fatal(copyErr)
			}
		}
	}
	add("[Content_Types].xml", 0)
	for index := 1; index <= sheets; index++ {
		add(fmt.Sprintf("xl/worksheets/sheet%d.xml", index), 0)
	}
	for index := 1; index <= slides; index++ {
		add(fmt.Sprintf("ppt/slides/slide%d.xml", index), 0)
	}
	mediaRoot := "word/media"
	if extension == ".xlsx" {
		mediaRoot = "xl/media"
	} else if extension == ".pptx" {
		mediaRoot = "ppt/media"
	}
	for index := 1; index <= media; index++ {
		add(fmt.Sprintf("%s/image%d.bin", mediaRoot, index), mediaBytes)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestValidateOfficePackageLimitsAtBoundary(t *testing.T) {
	tool := Tool{Limits: map[string]any{
		"maxSheets":             float64(100),
		"maxEmbeddedMedia":      float64(20),
		"maxEmbeddedMediaBytes": float64(1_000_000),
	}}
	path := officeLimitFixture(t, ".xlsx", 100, 0, 20, 1_000_000)
	if err := validateOfficePackageLimits(path, tool); err != nil {
		t.Fatalf("exact boundary rejected: %v", err)
	}
}

func TestValidateOfficePackageLimitsRejectsEachOverage(t *testing.T) {
	xlsx := Tool{Limits: map[string]any{
		"maxSheets":             float64(100),
		"maxEmbeddedMedia":      float64(20),
		"maxEmbeddedMediaBytes": float64(1_000_000),
	}}
	pptx := Tool{Limits: map[string]any{
		"maxSlides":             float64(500),
		"maxEmbeddedMedia":      float64(20),
		"maxEmbeddedMediaBytes": float64(1_000_000),
	}}
	cases := []struct {
		name string
		path string
		tool Tool
		want string
	}{
		{"sheet count", officeLimitFixture(t, ".xlsx", 101, 0, 0, 0), xlsx, "101 sheets"},
		{"slide count", officeLimitFixture(t, ".pptx", 0, 501, 0, 0), pptx, "501 slides"},
		{"media count", officeLimitFixture(t, ".docx", 0, 0, 21, 1), xlsx, "21 embedded media"},
		{"single media bytes", officeLimitFixture(t, ".docx", 0, 0, 1, 1_000_001), xlsx, "1000001 bytes"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			err := validateOfficePackageLimits(test.path, test.tool)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected error containing %q, got %v", test.want, err)
			}
		})
	}
}

func TestParseMediaProbeOutput(t *testing.T) {
	probe := `Duration: 01:02:03.50, start: 0.000000, bitrate: 1000 kb/s
Stream #0:0: Video: h264 (High), yuv420p, 3840x2160, 30 fps`
	duration, width, height, err := parseMediaProbeOutput(probe)
	if err != nil {
		t.Fatal(err)
	}
	if duration != 3723.5 || width != 3840 || height != 2160 {
		t.Fatalf("unexpected probe values duration=%v width=%d height=%d", duration, width, height)
	}
}

func TestValidateOptionsRejectsCatalogRangeAndChoice(t *testing.T) {
	tool := Tool{Params: []ParamDef{
		{Name: "size", Type: "number", Min: "1", Max: "500"},
		{Name: "quality", Choices: []string{"safe", "best"}},
	}}
	if err := validateOptions(map[string]string{"size": "501", "quality": "safe"}, tool); err == nil {
		t.Fatal("expected numeric maximum rejection")
	}
	if err := validateOptions(map[string]string{"size": "500", "quality": "unknown"}, tool); err == nil {
		t.Fatal("expected choice rejection")
	}
	if err := validateOptions(map[string]string{"size": "500", "quality": "best"}, tool); err != nil {
		t.Fatalf("exact boundary must be accepted: %v", err)
	}
}

func TestValidateMediaLimitsIgnoresImageSideInput(t *testing.T) {
	tool := Tool{Category: "视频工具", Limits: map[string]any{"maxDurationSeconds": float64(600)}}
	if err := validateMediaLimits(`C:\fixture\watermark.png`, tool); err != nil {
		t.Fatalf("image side input must not be probed as media: %v", err)
	}
}
