package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func verifyFirstBatch() {
	plain := sample("plain.txt")
	note := sample("note.md")
	page := sample("page.html")
	imagePath := sample("image.png")
	pdfPath := sample("sample.pdf")

	merged := run("merge-text", append(plain, plain...), map[string]string{"filename": "merged-large", "separator": "\\n---\\n"})[0]
	assertContains(merged, "---")
	assertContains(run("txt-to-markdown", plain, nil)[0], "# plain")
	assertContains(run("html-to-markdown", page, nil)[0], "# Header")
	run("markdown-to-pdf", note, nil)
	for _, encoding := range []string{"UTF-8", "UTF-8 BOM", "UTF-16LE", "GB18030"} {
		run("text-encoding", plain, map[string]string{"encoding": encoding})
	}

	run("rename-replace", plain, map[string]string{"old": "plain", "new": "renamed"})
	run("rename-insert", plain, map[string]string{"position": "2", "text": "_INSERT_"})
	run("rename-parent", plain, map[string]string{"separator": "_"})
	run("rename-case", plain, map[string]string{"mode": "大写"})
	run("rename-delete", plain, map[string]string{"text": "ain"})

	folder := filepath.Join(samples, "Demo Folder")
	must(os.MkdirAll(filepath.Join(folder, "level-1", "level-2"), 0755))
	must(os.WriteFile(filepath.Join(folder, "level-1", "large-data.txt"), bytes.Repeat([]byte("folder-data\n"), 1000), 0644))
	run("folder-replace", []string{folder}, map[string]string{"old": "Demo", "new": "Real"})
	run("folder-insert", []string{folder}, map[string]string{"position": "4", "text": "_TEST_"})
	run("folder-prefix-suffix", []string{folder}, map[string]string{"prefix": "PRE_", "suffix": "_POST"})
	run("folder-case", []string{folder}, map[string]string{"mode": "大写"})
	run("folder-delete", []string{folder}, map[string]string{"text": " Folder"})
	run("mirror-folders", []string{folder}, nil)
	timed := run("modify-file-times", plain, map[string]string{"time": "2020-02-03 04:05:06"})[0]
	info, err := os.Stat(timed)
	must(err)
	if info.ModTime().Sub(time.Date(2020, 2, 3, 4, 5, 6, 0, time.Local)) > time.Second {
		panic("modify-file-times did not set the requested timestamp")
	}

	run("image-enhance", imagePath, nil)
	run("image-resize", imagePath, map[string]string{"width": "320", "height": "0"})
	run("image-crop", imagePath, map[string]string{"left": "10", "top": "10", "cropWidth": "80", "cropHeight": "80"})
	run("image-rotate", imagePath, map[string]string{"angle": "旋转 180°"})
	run("image-compress", imagePath, map[string]string{"quality": "65"})

	run("pdf-merge", append(pdfPath, pdfPath...), nil)
	if len(run("pdf-split", pdfPath, map[string]string{"span": "1"})) != 3 {
		panic("pdf-split should create three documents")
	}
	run("pdf-rotate", pdfPath, map[string]string{"pages": "1-2", "angle": "180°"})
	run("pdf-reorder", pdfPath, map[string]string{"pages": "3,1,2"})
	run("pdf-extract-pages", pdfPath, map[string]string{"pages": "1,3"})
	run("pdf-odd-even", pdfPath, nil)

	video := filepath.Join(samples, "real-video.mp4")
	makeMediaSample(video)
	audio := run("video-extract-audio", []string{video}, nil)[0]
	run("video-remove-audio", []string{video}, nil)
	run("video-preview-grid", []string{video}, map[string]string{"interval": "1"})
	run("video-text-watermark", []string{video}, map[string]string{"text": "TEST"})
	run("video-image-watermark", []string{video, imagePath[0]}, map[string]string{"width": "80"})
	for _, target := range []string{"mp4", "avi", "mkv", "mov", "flv", "wmv", "webm", "mpeg", "3gp", "ogv", "ts"} {
		run("video-to-"+target, []string{video}, nil)
	}
	for _, target := range []string{"mp3", "aac", "m4a", "wma", "wav", "flac", "ogg", "opus"} {
		run("audio-to-"+target, []string{audio}, nil)
	}
}

func makeMediaSample(path string) {
	ffmpeg := filepath.Join(root, "tools", "ffmpeg", "ffmpeg.exe")
	args := []string{
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24",
		"-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000",
		"-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path,
	}
	cmd := exec.Command(ffmpeg, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		panic("create media sample: " + strings.TrimSpace(stderr.String()))
	}
}
