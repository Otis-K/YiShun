package main

import (
	"archive/zip"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSanitizeXLSXWithoutImagesRemovesAllDrawingReferences(t *testing.T) {
	path := filepath.Join(t.TempDir(), "with-images.xlsx")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	entries := map[string]string{
		"[Content_Types].xml":                 `<Types><Override PartName="/xl/drawings/drawing1.xml" ContentType="drawing"/><Override PartName="/xl/workbook.xml" ContentType="workbook"/></Types>`,
		"xl/workbook.xml":                     `<workbook>keep</workbook>`,
		"xl/worksheets/sheet1.xml":            `<worksheet xmlns:r="relationships"><sheetData/><drawing r:id="rId1"/></worksheet>`,
		"xl/worksheets/_rels/sheet1.xml.rels": `<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/xl/drawings/drawing1.xml" Id="rId1"/><Relationship Type="keep" Target="keep.xml" Id="rId2"/></Relationships>`,
		"xl/drawings/drawing1.xml":            `<drawing/>`,
		"xl/drawings/_rels/drawing1.xml.rels": `<Relationships/>`,
		"xl/media/image1.png":                 "image bytes",
	}
	for name, value := range entries {
		entry, createErr := writer.Create(name)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, writeErr := io.WriteString(entry, value); writeErr != nil {
			t.Fatal(writeErr)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	if err := sanitizeXLSXWithoutImages(path); err != nil {
		t.Fatal(err)
	}
	archive, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	contents := map[string]string{}
	for _, entry := range archive.File {
		if strings.HasPrefix(entry.Name, "xl/drawings/") || strings.HasPrefix(entry.Name, "xl/media/") {
			t.Fatalf("image part survived: %s", entry.Name)
		}
		reader, openErr := entry.Open()
		if openErr != nil {
			t.Fatal(openErr)
		}
		data, readErr := io.ReadAll(reader)
		_ = reader.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		contents[entry.Name] = string(data)
	}
	if strings.Contains(contents["xl/worksheets/sheet1.xml"], "drawing") {
		t.Fatal("worksheet drawing element survived")
	}
	if strings.Contains(contents["xl/worksheets/_rels/sheet1.xml.rels"], "/drawing") {
		t.Fatal("worksheet drawing relationship survived")
	}
	if !strings.Contains(contents["xl/worksheets/_rels/sheet1.xml.rels"], `Type="keep"`) {
		t.Fatal("unrelated worksheet relationship was removed")
	}
	if strings.Contains(contents["[Content_Types].xml"], "/xl/drawings/") {
		t.Fatal("drawing content-type override survived")
	}
	if contents["xl/workbook.xml"] != `<workbook>keep</workbook>` {
		t.Fatal("unrelated workbook content changed")
	}
}
