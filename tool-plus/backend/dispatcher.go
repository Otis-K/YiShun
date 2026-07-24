package main

import (
	"archive/zip"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

func dispatch(req Request) Response {
	tool, ok := findTool(req.Tool)
	if !ok {
		return Response{OK: false, Error: "unknown tool: " + req.Tool}
	}
	if err := validateOptions(req.Options, tool); err != nil {
		return Response{OK: false, Error: err.Error()}
	}
	if strings.TrimSpace(req.OutputDir) == "" {
		workspaceRoot := strings.TrimSpace(os.Getenv("TOOLPLUS_WORKSPACE_ROOT"))
		if workspaceRoot == "" {
			workspaceRoot = `G:\tool-user-file`
		}
		req.OutputDir = filepath.Join(workspaceRoot, tool.Key, "output")
	}
	if err := os.MkdirAll(req.OutputDir, 0o755); err != nil {
		return Response{OK: false, Error: fmt.Sprintf("output directory cannot be created: %v", err)}
	}
	if tool.InputKind != "none" && len(req.Inputs) == 0 {
		return Response{OK: false, Error: "at least one input is required"}
	}
	if minInputs, exists := integerLimit(tool, "minInputs"); exists && int64(len(req.Inputs)) < minInputs {
		return Response{OK: false, Error: fmt.Sprintf("input count %d is below tool minimum %d", len(req.Inputs), minInputs)}
	}
	if maxInputs, exists := integerLimit(tool, "maxInputs"); exists && int64(len(req.Inputs)) > maxInputs {
		return Response{OK: false, Error: fmt.Sprintf("input count %d exceeds tool maximum %d", len(req.Inputs), maxInputs)}
	}
	maxInputBytes, hasByteLimit := integerLimit(tool, "maxInputBytes")
	for index, input := range req.Inputs {
		if strings.TrimSpace(input) == "" {
			return Response{OK: false, Error: fmt.Sprintf("input %d is empty", index+1)}
		}
		info, err := os.Stat(input)
		if err != nil {
			return Response{OK: false, Error: fmt.Sprintf("input %d is not accessible: %v", index+1, err)}
		}
		if hasByteLimit && info.Mode().IsRegular() && info.Size() > maxInputBytes {
			return Response{OK: false, Error: fmt.Sprintf("input %d is %d bytes and exceeds tool maximum %d bytes", index+1, info.Size(), maxInputBytes)}
		}
		if info.Mode().IsRegular() {
			if err := validateOfficePackageLimits(input, tool); err != nil {
				return Response{OK: false, Error: fmt.Sprintf("input %d is outside Office limits: %v", index+1, err)}
			}
			if err := validateMediaLimits(input, tool); err != nil {
				return Response{OK: false, Error: fmt.Sprintf("input %d is outside media limits: %v", index+1, err)}
			}
			if err := validatePDFInput(input, tool); err != nil {
				return Response{OK: false, Error: fmt.Sprintf("input %d is outside PDF limits: %v", index+1, err)}
			}
		}
	}
	authorization, err := authorizeExecution(req, tool)
	if err != nil {
		return Response{OK: false, Error: err.Error()}
	}
	var response Response
	switch tool.Category {
	case "文本工具":
		response = runText(req)
	case "图片工具":
		response = runImage(req)
	case "Word 工具", "Excel 工具", "PPT 工具":
		response = runOffice(req)
	case "PDF 工具":
		response = runPDF(req)
	case "视频工具", "音频工具", "网页工具":
		response = runMedia(req)
	default:
		response = runFileOps(req)
	}
	settleExecution(authorization, response)
	return response
}

func validateOptions(options map[string]string, tool Tool) error {
	for _, param := range tool.Params {
		value, supplied := options[param.Name]
		value = strings.TrimSpace(value)
		if !supplied || value == "" {
			continue
		}
		if param.Type == "number" {
			number, err := strconv.ParseFloat(value, 64)
			if err != nil {
				return fmt.Errorf("option %s must be a number", param.Name)
			}
			if param.Min != "" {
				minimum, err := strconv.ParseFloat(param.Min, 64)
				if err == nil && number < minimum {
					return fmt.Errorf("option %s is below minimum %s", param.Name, param.Min)
				}
			}
			if param.Max != "" {
				maximum, err := strconv.ParseFloat(param.Max, 64)
				if err == nil && number > maximum {
					return fmt.Errorf("option %s exceeds maximum %s", param.Name, param.Max)
				}
			}
		}
		if len(param.Choices) > 0 {
			matched := false
			for _, choice := range param.Choices {
				if value == choice {
					matched = true
					break
				}
			}
			if !matched {
				return fmt.Errorf("option %s is not an allowed choice", param.Name)
			}
		}
	}
	return nil
}

var (
	mediaDurationPattern = regexp.MustCompile(`(?i)Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)`)
	mediaSizePattern     = regexp.MustCompile(`(?i)Video:[^\r\n]*?\b(\d{2,5})x(\d{2,5})\b`)
)

func validateMediaLimits(input string, tool Tool) error {
	if tool.Category != "视频工具" && tool.Category != "音频工具" {
		return nil
	}
	extension := strings.ToLower(filepath.Ext(input))
	mediaExtensions := map[string]bool{
		".mp4": true, ".avi": true, ".mkv": true, ".mov": true, ".flv": true,
		".wmv": true, ".webm": true, ".mpeg": true, ".mpg": true, ".3gp": true,
		".ogv": true, ".ts": true, ".mp3": true, ".aac": true, ".m4a": true,
		".wma": true, ".wav": true, ".flac": true, ".ogg": true, ".opus": true,
	}
	if !mediaExtensions[extension] {
		return nil
	}
	maxWidth, hasWidth := integerLimit(tool, "maxWidth")
	maxHeight, hasHeight := integerLimit(tool, "maxHeight")
	maxDuration, hasDuration := integerLimit(tool, "maxDurationSeconds")
	if !hasWidth && !hasHeight && !hasDuration {
		return nil
	}
	ffmpeg := filepath.Join("tools", "ffmpeg", "ffmpeg.exe")
	if _, err := os.Stat(ffmpeg); err != nil {
		executable, executableErr := os.Executable()
		if executableErr == nil {
			ffmpeg = filepath.Join(filepath.Dir(filepath.Dir(executable)), "tools", "ffmpeg", "ffmpeg.exe")
		}
	}
	if _, err := os.Stat(ffmpeg); err != nil {
		return fmt.Errorf("bundled FFmpeg metadata inspector is unavailable: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	output, _ := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-i", input).CombinedOutput()
	if ctx.Err() != nil {
		return fmt.Errorf("media metadata inspection timed out")
	}
	duration, width, height, err := parseMediaProbeOutput(string(output))
	if err != nil {
		return err
	}
	if hasDuration && duration > float64(maxDuration)+0.01 {
		return fmt.Errorf("duration %.3f seconds exceeds maximum %d seconds", duration, maxDuration)
	}
	if hasWidth && width > maxWidth {
		return fmt.Errorf("width %d exceeds maximum %d", width, maxWidth)
	}
	if hasHeight && height > maxHeight {
		return fmt.Errorf("height %d exceeds maximum %d", height, maxHeight)
	}
	return nil
}

func parseMediaProbeOutput(output string) (duration float64, width, height int64, err error) {
	durationMatch := mediaDurationPattern.FindStringSubmatch(output)
	if durationMatch == nil {
		return 0, 0, 0, fmt.Errorf("FFmpeg did not report a readable duration")
	}
	hours, _ := strconv.ParseFloat(durationMatch[1], 64)
	minutes, _ := strconv.ParseFloat(durationMatch[2], 64)
	seconds, parseErr := strconv.ParseFloat(durationMatch[3], 64)
	if parseErr != nil {
		return 0, 0, 0, fmt.Errorf("invalid media duration: %w", parseErr)
	}
	duration = hours*3600 + minutes*60 + seconds
	if sizeMatch := mediaSizePattern.FindStringSubmatch(output); sizeMatch != nil {
		width, _ = strconv.ParseInt(sizeMatch[1], 10, 64)
		height, _ = strconv.ParseInt(sizeMatch[2], 10, 64)
	}
	return duration, width, height, nil
}

func validateOfficePackageLimits(input string, tool Tool) error {
	extension := strings.ToLower(filepath.Ext(input))
	if extension != ".docx" && extension != ".xlsx" && extension != ".pptx" {
		return nil
	}
	maxSheets, hasSheetLimit := integerLimit(tool, "maxSheets")
	maxSlides, hasSlideLimit := integerLimit(tool, "maxSlides")
	maxMedia, hasMediaLimit := integerLimit(tool, "maxEmbeddedMedia")
	maxMediaBytes, hasMediaByteLimit := integerLimit(tool, "maxEmbeddedMediaBytes")
	if !hasSheetLimit && !hasSlideLimit && !hasMediaLimit && !hasMediaByteLimit {
		return nil
	}
	archive, err := zip.OpenReader(input)
	if err != nil {
		return fmt.Errorf("invalid OOXML package: %w", err)
	}
	defer archive.Close()
	var sheets, slides, media int64
	for _, entry := range archive.File {
		name := strings.ToLower(strings.ReplaceAll(entry.Name, `\`, "/"))
		if strings.HasPrefix(name, "xl/worksheets/sheet") && strings.HasSuffix(name, ".xml") {
			sheets++
		}
		if strings.HasPrefix(name, "ppt/slides/slide") && strings.HasSuffix(name, ".xml") {
			slides++
		}
		if strings.HasPrefix(name, "word/media/") || strings.HasPrefix(name, "xl/media/") || strings.HasPrefix(name, "ppt/media/") {
			media++
			if hasMediaByteLimit && entry.UncompressedSize64 > uint64(maxMediaBytes) {
				return fmt.Errorf("embedded media %q is %d bytes and exceeds maximum %d bytes", entry.Name, entry.UncompressedSize64, maxMediaBytes)
			}
		}
	}
	if hasSheetLimit && sheets > maxSheets {
		return fmt.Errorf("workbook has %d sheets and exceeds maximum %d", sheets, maxSheets)
	}
	if hasSlideLimit && slides > maxSlides {
		return fmt.Errorf("presentation has %d slides and exceeds maximum %d", slides, maxSlides)
	}
	if hasMediaLimit && media > maxMedia {
		return fmt.Errorf("package has %d embedded media parts and exceeds maximum %d", media, maxMedia)
	}
	return nil
}

func integerLimit(tool Tool, name string) (int64, bool) {
	value, exists := tool.Limits[name]
	if !exists {
		return 0, false
	}
	switch number := value.(type) {
	case float64:
		if number >= 0 {
			return int64(number), true
		}
	case int:
		if number >= 0 {
			return int64(number), true
		}
	case int64:
		if number >= 0 {
			return number, true
		}
	}
	return 0, false
}
