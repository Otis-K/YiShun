package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	_ "image/jpeg"
	"image/png"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/go-pdf/fpdf"
	"github.com/xuri/excelize/v2"
)

type request struct {
	Tool      string            `json:"tool"`
	Inputs    []string          `json:"inputs"`
	OutputDir string            `json:"outputDir"`
	Options   map[string]string `json:"options"`
}

type response struct {
	OK      bool     `json:"ok"`
	Outputs []string `json:"outputs"`
	Error   string   `json:"error"`
}

var root string
var backend string
var work string
var samples string
var outputs string

func main() {
	var err error
	root, err = filepath.Abs(".")
	must(err)
	backend = filepath.Join(root, "bin", "toolplus-backend.exe")
	work = filepath.Join(root, "work", "verify")
	samples = filepath.Join(work, "samples")
	outputs = filepath.Join(work, "outputs")
	_ = os.RemoveAll(work)
	must(os.MkdirAll(samples, 0755))
	must(os.MkdirAll(outputs, 0755))
	makeSamples()

	check("catalog", verifyCatalog)
	check("default-output", verifyDefaultOutput)
	check("text", verifyText)
	check("file", verifyFile)
	check("image", verifyImage)
	check("docx", verifyDocx)
	check("xlsx", verifyXlsx)
	check("pdf", verifyPDF)
	check("first-batch", verifyFirstBatch)
	fmt.Println("ALL PASS", work)
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

func check(name string, fn func()) {
	fn()
	fmt.Println("PASS", name)
}

func run(tool string, inputs []string, opt map[string]string) []string {
	req := request{Tool: tool, Inputs: inputs, OutputDir: filepath.Join(outputs, tool), Options: opt}
	must(os.MkdirAll(req.OutputDir, 0755))
	b, _ := json.Marshal(req)
	cmd := exec.Command(backend, "run")
	cmd.Stdin = bytes.NewReader(b)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		panic(fmt.Sprintf("%s failed: %v %s", tool, err, stderr.String()))
	}
	var resp response
	must(json.Unmarshal(stdout.Bytes(), &resp))
	if !resp.OK {
		panic(fmt.Sprintf("%s failed: %s", tool, resp.Error))
	}
	for _, out := range resp.Outputs {
		info, err := os.Stat(out)
		if err != nil || (!info.IsDir() && info.Size() == 0) {
			panic(fmt.Sprintf("%s output invalid: %s", tool, out))
		}
	}
	return resp.Outputs
}

func verifyCatalog() {
	cmd := exec.Command(backend, "catalog")
	out, err := cmd.Output()
	must(err)
	var result struct {
		OK    bool `json:"ok"`
		Tools []struct {
			Key string `json:"key"`
		} `json:"tools"`
	}
	must(json.Unmarshal(out, &result))
	if !result.OK || len(result.Tools) != 114 {
		panic(fmt.Sprintf("catalog expected 114 tools, got %d", len(result.Tools)))
	}
	keys := string(out)
	for _, key := range []string{"markdown-to-html", "classify-advanced", "image-modern-convert", "pdf-page-numbers", "pptx-replace-images", "audio-to-mp4-cover", "web-video-download"} {
		if !strings.Contains(keys, key) {
			panic("catalog missing " + key)
		}
	}
}

func verifyDefaultOutput() {
	cmd := exec.Command(backend, "init-output")
	out, err := cmd.Output()
	must(err)
	var initialized response
	must(json.Unmarshal(out, &initialized))
	if !initialized.OK || len(initialized.Outputs) != 1 {
		panic("default output initialization failed")
	}
	root := filepath.Join(`G:\`, "tool-user-file")
	entries, err := os.ReadDir(root)
	must(err)
	if len(entries) < 114 {
		panic(fmt.Sprintf("default output expected at least 114 tool folders, got %d", len(entries)))
	}
	req := request{Tool: "markdown-to-html", Inputs: sample("note.md"), Options: map[string]string{}}
	b, _ := json.Marshal(req)
	cmd = exec.Command(backend, "run")
	cmd.Stdin = bytes.NewReader(b)
	out, err = cmd.Output()
	must(err)
	var result response
	must(json.Unmarshal(out, &result))
	expectedDir := filepath.Join(root, "markdown-to-html", "output")
	if !result.OK || len(result.Outputs) != 1 || !strings.HasPrefix(strings.ToLower(result.Outputs[0]), strings.ToLower(expectedDir+string(filepath.Separator))) {
		panic(fmt.Sprintf("default output path mismatch: %#v", result))
	}
	if _, err := os.Stat(result.Outputs[0]); err != nil {
		panic("default output file was not created")
	}
}

func makeSamples() {
	must(os.WriteFile(filepath.Join(samples, "note.md"), []byte("# Title\n\nHello **World**\n"), 0644))
	must(os.WriteFile(filepath.Join(samples, "page.html"), []byte("<html><body><h1>Header</h1><p>Hello HTML</p></body></html>"), 0644))
	must(os.WriteFile(filepath.Join(samples, "plain.txt"), []byte("foo line\nkeep line\n  spaced  \n"), 0644))
	makeImage(filepath.Join(samples, "image.png"))
	makeSVG(filepath.Join(samples, "shape.svg"))
	makeDocx(filepath.Join(samples, "doc.docx"), "Hello OLD Word")
	makeXlsx(filepath.Join(samples, "book.xlsx"))
	makePptx(filepath.Join(samples, "slides.pptx"))
	makePDF(filepath.Join(samples, "sample.pdf"))
	makeMediaSamples()
}

func verifyText() {
	assertContains(run("markdown-to-html", sample("note.md"), nil)[0], "<h1>")
	assertContains(run("markdown-to-txt", sample("note.md"), nil)[0], "Title")
	assertContains(run("html-to-txt", sample("page.html"), nil)[0], "Hello HTML")
	assertContains(run("txt-to-html", sample("plain.txt"), nil)[0], "foo line")
	assertContains(run("replace-text", sample("plain.txt"), map[string]string{"old": "foo", "new": "bar"})[0], "bar line")
	assertContains(run("replace-lines", sample("plain.txt"), map[string]string{"keyword": "keep", "replacement": "REPLACED"})[0], "REPLACED")
	noWS, _ := os.ReadFile(run("remove-whitespace", sample("plain.txt"), map[string]string{"mode": "all"})[0])
	if strings.Contains(string(noWS), " ") {
		panic("remove-whitespace still contains spaces")
	}
}

func verifyFile() {
	src := filepath.Join(samples, "rename.txt")
	must(os.WriteFile(src, []byte("x"), 0644))
	outs := run("rename-prefix-suffix", []string{src}, map[string]string{"prefix": "pre_", "suffix": "_suf"})
	if filepath.Base(outs[0]) != "pre_rename_suf.txt" {
		panic("rename-prefix-suffix unexpected output")
	}
	if _, err := os.Stat(src); err != nil {
		panic("rename-prefix-suffix should preserve the original file")
	}
	run("classify-extension", sample("plain.txt"), nil)
	run("classify-filename", sample("plain.txt"), map[string]string{"groupLen": "2"})
	classified := run("classify-advanced", sample("plain.txt"), map[string]string{"mode": "正则表达式", "pattern": "^([a-z]+)"})[0]
	if filepath.Base(filepath.Dir(classified)) != "plain" {
		panic("advanced regular-expression classification failed")
	}
}

func verifyImage() {
	jpg := run("image-convert", sample("image.png"), map[string]string{"format": "jpg"})[0]
	run("image-convert", sample("image.png"), map[string]string{"format": "bmp"})
	run("image-watermark", sample("image.png"), map[string]string{"text": "DEMO"})
	outs := run("image-split", sample("image.png"), map[string]string{"rows": "2", "cols": "2"})
	if len(outs) != 4 {
		panic("image split should create 4 outputs")
	}
	resized := run("image-edit", sample("image.png"), map[string]string{"operation": "缩放", "width": "80", "height": "0"})[0]
	assertImageSize(resized, 80, 50)
	rotated := run("image-edit", sample("image.png"), map[string]string{"operation": "顺时针旋转 90°"})[0]
	assertImageSize(rotated, 100, 160)
	withMetadata := run("image-metadata", []string{jpg}, map[string]string{
		"action": "设置元数据", "title": "验收图片", "artist": "ToolPlus 测试", "comment": "真实文件验收",
	})[0]
	metadata := readMetadata(withMetadata)
	if metadata["Title"] != "验收图片" || metadata["Creator"] != "ToolPlus 测试" || metadata["Description"] != "真实文件验收" {
		panic(fmt.Sprintf("image metadata mismatch: %#v", metadata))
	}
	cleared := run("image-metadata", []string{withMetadata}, map[string]string{"action": "清除元数据"})[0]
	clearedMetadata := readMetadata(cleared)
	if clearedMetadata["Title"] != "" || clearedMetadata["Creator"] != "" || clearedMetadata["Description"] != "" {
		panic(fmt.Sprintf("image metadata was not cleared: %#v", clearedMetadata))
	}
	run("svg-to-pdf", sample("shape.svg"), nil)
	run("svg-to-jpg", sample("shape.svg"), nil)
	for _, format := range []string{"webp", "avif", "tga", "psd", "svg"} {
		run("image-modern-convert", sample("image.png"), map[string]string{"format": format})
	}
	for _, effect := range []string{"灰度", "棕褐色", "亮度", "对比度", "模糊", "锐化", "反相"} {
		run("image-effects", sample("image.png"), map[string]string{"effect": effect, "amount": "25"})
	}
}

func verifyDocx() {
	assertContains(run("docx-to-txt", sample("doc.docx"), nil)[0], "Hello OLD Word")
	assertContains(run("docx-to-html", sample("doc.docx"), nil)[0], "Hello OLD Word")
	assertContainsDocx(run("docx-replace", sample("doc.docx"), map[string]string{"old": "OLD", "new": "NEW"})[0], "NEW")
	verifyOfficeImageTools("docx", sample("doc.docx"))
}

func verifyXlsx() {
	outs := run("xlsx-to-csv", sample("book.xlsx"), nil)
	if len(outs) != 1 {
		panic("xlsx-to-csv should create 1 output")
	}
	assertContains(outs[0], "OLD item")
	assertContains(run("xlsx-to-json", sample("book.xlsx"), nil)[0], "OLD item")
	replaced := run("xlsx-replace", sample("book.xlsx"), map[string]string{"old": "OLD", "new": "NEW"})[0]
	f, err := excelize.OpenFile(replaced)
	must(err)
	defer f.Close()
	v, _ := f.GetCellValue("Sheet1", "A2")
	if v != "NEW item" {
		panic("xlsx replace failed")
	}
	verifyOfficeImageTools("xlsx", sample("book.xlsx"))
	verifyOfficeImageTools("pptx", sample("slides.pptx"))
}

func verifyPDF() {
	run("pdf-delete-pages", sample("sample.pdf"), map[string]string{"pages": "2"})
	encrypted := run("pdf-encrypt", sample("sample.pdf"), map[string]string{"password": "secret"})[0]
	run("pdf-decrypt", []string{encrypted}, map[string]string{"password": "secret"})
	run("pdf-watermark", sample("sample.pdf"), map[string]string{"text": "WATERMARK"})
	run("pdf-stamp", sample("sample.pdf"), map[string]string{"text": "APPROVED"})
	redacted := run("pdf-redact", sample("sample.pdf"), map[string]string{
		"pages": "1", "left": "0", "top": "0", "width": "100", "height": "100", "style": "黑色遮盖",
	})[0]
	redactedText := run("pdf-to-txt", []string{redacted}, nil)[0]
	b, err := os.ReadFile(redactedText)
	must(err)
	if strings.Contains(string(b), "Hello PDF page 1") {
		panic("pdf-redact retained the original text layer")
	}
	assertContains(run("pdf-to-txt", sample("sample.pdf"), nil)[0], "Hello PDF page 1")
	images := run("pdf-to-jpg", sample("sample.pdf"), nil)
	if len(images) != 3 {
		panic("pdf-to-jpg should create 3 outputs")
	}
	run("pdf-add-margin", sample("sample.pdf"), map[string]string{"margin": "20"})
	run("pdf-modify", sample("sample.pdf"), map[string]string{"operation": "旋转页面", "pages": "1", "angle": "顺时针 90°"})
	reordered := run("pdf-modify", sample("sample.pdf"), map[string]string{"operation": "重排/提取页面", "pages": "3,1,2"})[0]
	reorderedTextPath := run("pdf-to-txt", []string{reordered}, nil)[0]
	reorderedText, err := os.ReadFile(reorderedTextPath)
	must(err)
	text := string(reorderedText)
	page3, page1, page2 := strings.Index(text, "page 3"), strings.Index(text, "page 1"), strings.Index(text, "page 2")
	if page3 < 0 || page1 <= page3 || page2 <= page1 {
		panic("pdf page reorder did not produce the requested 3,1,2 order")
	}
	run("pdf-compress", sample("sample.pdf"), nil)
	if len(run("pdf-extract-images", sample("sample.pdf"), map[string]string{"pages": "all"})) == 0 {
		panic("PDF image extraction returned no images")
	}
	numbered := run("pdf-page-numbers", sample("sample.pdf"), map[string]string{"format": "Page %p / %P", "position": "底部居中", "fontSize": "10", "start": "1"})[0]
	if _, err := os.Stat(numbered); err != nil {
		panic("numbered PDF missing")
	}
	meta := run("pdf-metadata", sample("sample.pdf"), map[string]string{"action": "设置元数据", "title": "ToolPlus PDF", "author": "验收"})[0]
	metaOut, err := exec.Command(filepath.Join(root, "tools", "exiftool", "exiftool.exe"), "-s3", "-Title", meta).Output()
	must(err)
	if !strings.Contains(string(metaOut), "ToolPlus PDF") {
		panic("PDF metadata was not written")
	}
	verifyMediaTools()
}

func verifyOfficeImageTools(kind string, inputs []string) {
	prefix := map[string]string{"docx": "word/media/", "xlsx": "xl/media/", "pptx": "ppt/media/"}[kind]
	extracted := run(kind+"-extract-images", inputs, nil)
	if len(extracted) == 0 {
		panic(kind + " image extraction returned no files")
	}
	replaced := run(kind+"-replace-images", []string{inputs[0], filepath.Join(samples, "image.png")}, nil)[0]
	if countZipPrefix(replaced, prefix) == 0 {
		panic(kind + " image replacement removed media")
	}
	removed := run(kind+"-remove-images", inputs, nil)[0]
	expected := 0
	if kind == "pptx" {
		// PPT keeps one transparent placeholder so picture shape and animation IDs
		// remain valid while the original slide image payloads are removed.
		expected = 1
	}
	if countZipPrefix(removed, prefix) != expected {
		panic(kind + " image removal retained media")
	}
}

func verifyMediaTools() {
	video := []string{filepath.Join(samples, "video.mp4")}
	audio := []string{filepath.Join(samples, "audio.wav")}
	for _, tool := range []string{"video-to-aac-audio", "video-to-ogg-audio", "video-to-opus-audio"} {
		run(tool, video, nil)
	}
	run("video-trim", video, map[string]string{"start": "0.5", "duration": "1"})
	run("video-resize", video, map[string]string{"width": "320", "height": "0"})
	run("video-frame-rate", video, map[string]string{"fps": "15"})
	run("video-bitrate", video, map[string]string{"bitrate": "500"})
	run("media-volume", audio, map[string]string{"volume": "150"})
	run("audio-to-mp4-cover", audio, map[string]string{"width": "640", "height": "360", "color": "#1f2937"})
	run("audio-to-mp4-cover", []string{audio[0], filepath.Join(samples, "image.png")}, map[string]string{"width": "640", "height": "360"})
	run("audio-merge", []string{audio[0], audio[0]}, nil)
	run("video-merge", []string{video[0], video[0]}, nil)
}

func countZipPrefix(path, prefix string) int {
	r, err := zip.OpenReader(path)
	must(err)
	defer r.Close()
	count := 0
	for _, f := range r.File {
		if strings.HasPrefix(f.Name, prefix) && !strings.HasSuffix(f.Name, "/") {
			count++
		}
	}
	return count
}

func sample(name string) []string { return []string{filepath.Join(samples, name)} }

func assertContains(path, text string) {
	b, err := os.ReadFile(path)
	must(err)
	if !strings.Contains(string(b), text) {
		panic(fmt.Sprintf("%s missing %q", path, text))
	}
}

func assertContainsDocx(path, text string) {
	r, err := zip.OpenReader(path)
	must(err)
	defer r.Close()
	for _, f := range r.File {
		if f.Name == "word/document.xml" {
			rc, err := f.Open()
			must(err)
			defer rc.Close()
			b, _ := io.ReadAll(rc)
			if strings.Contains(string(b), text) {
				return
			}
		}
	}
	panic("docx text not found")
}

func assertImageSize(path string, width, height int) {
	f, err := os.Open(path)
	must(err)
	defer f.Close()
	config, _, err := image.DecodeConfig(f)
	must(err)
	if config.Width != width || config.Height != height {
		panic(fmt.Sprintf("%s expected %dx%d, got %dx%d", path, width, height, config.Width, config.Height))
	}
}

func readMetadata(path string) map[string]string {
	exe := filepath.Join(root, "tools", "exiftool", "exiftool.exe")
	out, err := exec.Command(exe, "-j", "-Title", "-Creator", "-Description", path).Output()
	must(err)
	var items []map[string]any
	must(json.Unmarshal(out, &items))
	if len(items) != 1 {
		panic("ExifTool returned unexpected metadata result")
	}
	result := map[string]string{}
	for _, key := range []string{"Title", "Creator", "Description"} {
		if value, ok := items[0][key].(string); ok {
			result[key] = value
		}
	}
	return result
}

func makeImage(path string) {
	img := image.NewRGBA(image.Rect(0, 0, 160, 100))
	for y := 0; y < 100; y++ {
		for x := 0; x < 160; x++ {
			img.Set(x, y, color.RGBA{R: uint8(72 + x/4), G: uint8(82 + y/5), B: uint8(108 + (x+y)/12), A: 255})
		}
	}
	for y := 7; y < 27; y++ {
		for x := 11; x < 43; x++ {
			img.Set(x, y, color.RGBA{R: 210, G: 45, B: 52, A: 255})
		}
	}
	for y := 70; y < 92; y++ {
		for x := 118; x < 151; x++ {
			img.Set(x, y, color.RGBA{R: 28, G: 150, B: 86, A: 255})
		}
	}
	f, err := os.Create(path)
	must(err)
	defer f.Close()
	must(png.Encode(f, img))
}

func makeSVG(path string) {
	body := `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="orange"/><text x="12" y="44" font-size="20">SVG</text></svg>`
	must(os.WriteFile(path, []byte(body), 0644))
}

func makeDocx(path, text string) {
	f, err := os.Create(path)
	must(err)
	defer f.Close()
	w := zip.NewWriter(f)
	files := map[string]string{
		"[Content_Types].xml":          `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
		"_rels/.rels":                  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
		"word/document.xml":            `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:t>` + text + `</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="571500"/><wp:docPr id="1" name="Picture 1"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdImage1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:ext cx="914400" cy="571500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>`,
		"word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`,
	}
	for name, body := range files {
		fw, err := w.Create(name)
		must(err)
		_, err = fw.Write([]byte(body))
		must(err)
	}
	img, err := os.ReadFile(filepath.Join(samples, "image.png"))
	must(err)
	fw, err := w.Create("word/media/image1.png")
	must(err)
	_, err = fw.Write(img)
	must(err)
	must(w.Close())
}

func makeXlsx(path string) {
	f := excelize.NewFile()
	defer f.Close()
	f.SetSheetName("Sheet1", "Sheet1")
	f.SetCellValue("Sheet1", "A1", "name")
	f.SetCellValue("Sheet1", "B1", "value")
	f.SetCellValue("Sheet1", "A2", "OLD item")
	f.SetCellValue("Sheet1", "B2", 10)
	must(f.AddPicture("Sheet1", "D2", filepath.Join(samples, "image.png"), &excelize.GraphicOptions{ScaleX: 0.5, ScaleY: 0.5}))
	must(f.SaveAs(path))
}

func makePptx(path string) {
	f, err := os.Create(path)
	must(err)
	defer f.Close()
	w := zip.NewWriter(f)
	files := map[string]string{
		"[Content_Types].xml":              `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`,
		"_rels/.rels":                      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
		"ppt/presentation.xml":             `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
		"ppt/_rels/presentation.xml.rels":  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`,
		"ppt/slides/slide1.xml":            `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:pic><p:nvPicPr><p:cNvPr id="2" name="Picture 1"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImage1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="2500000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`,
		"ppt/slides/_rels/slide1.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
	}
	for name, body := range files {
		fw, err := w.Create(name)
		must(err)
		_, err = fw.Write([]byte(body))
		must(err)
	}
	img, err := os.ReadFile(filepath.Join(samples, "image.png"))
	must(err)
	fw, err := w.Create("ppt/media/image1.png")
	must(err)
	_, err = fw.Write(img)
	must(err)
	must(w.Close())
}

func makePDF(path string) {
	pdf := fpdf.New("P", "mm", "A4", "")
	for i := 1; i <= 3; i++ {
		pdf.AddPage()
		pdf.SetFont("Arial", "", 16)
		pdf.Cell(40, 10, fmt.Sprintf("Hello PDF page %d", i))
		pdf.ImageOptions(filepath.Join(samples, "image.png"), 20, 30, 60, 0, false, fpdf.ImageOptions{ImageType: "PNG", ReadDpi: true}, 0, "")
	}
	must(pdf.OutputFileAndClose(path))
}

func makeMediaSamples() {
	ffmpeg := filepath.Join(root, "tools", "ffmpeg", "ffmpeg.exe")
	cmd := exec.Command(ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", filepath.Join(samples, "video.mp4"))
	must(cmd.Run())
	cmd = exec.Command(ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "3", "-c:a", "pcm_s16le", filepath.Join(samples, "audio.wav"))
	must(cmd.Run())
}
