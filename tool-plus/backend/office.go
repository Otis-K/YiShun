package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var (
	xlsxDrawingElement  = regexp.MustCompile(`(?is)<(?:[A-Za-z_][\w.-]*:)?drawing\b[^>]*/\s*>`)
	xlsxDrawingRelation = regexp.MustCompile(`(?is)<(?:[A-Za-z_][\w.-]*:)?Relationship\b[^>]*/\s*>`)
	xlsxDrawingOverride = regexp.MustCompile(`(?is)<(?:[A-Za-z_][\w.-]*:)?Override\b[^>]*/\s*>`)
)

func runOffice(req Request) Response {
	response := runEngine(req)
	if !response.OK || req.Tool != "xlsx-remove-images" {
		return response
	}
	for _, output := range response.Outputs {
		if strings.EqualFold(filepath.Ext(output), ".xlsx") {
			if err := sanitizeXLSXWithoutImages(output); err != nil {
				return Response{OK: false, Error: fmt.Sprintf("failed to finalize image-free workbook: %v", err)}
			}
		}
	}
	return response
}

func removeXMLTagsContaining(data []byte, pattern *regexp.Regexp, needle []byte) []byte {
	return pattern.ReplaceAllFunc(data, func(tag []byte) []byte {
		if bytes.Contains(bytes.ToLower(tag), needle) {
			return nil
		}
		return tag
	})
}

func sanitizeXLSXWithoutImages(path string) error {
	source, err := zip.OpenReader(path)
	if err != nil {
		return err
	}
	defer source.Close()

	temporary := path + ".sanitize.tmp"
	backup := path + ".unsanitized.tmp"
	_ = os.Remove(temporary)
	_ = os.Remove(backup)
	file, err := os.Create(temporary)
	if err != nil {
		return err
	}
	archive := zip.NewWriter(file)
	closeWithError := func(current error) error {
		if archiveErr := archive.Close(); current == nil {
			current = archiveErr
		}
		if fileErr := file.Close(); current == nil {
			current = fileErr
		}
		return current
	}

	for _, entry := range source.File {
		name := strings.ToLower(strings.ReplaceAll(entry.Name, `\`, "/"))
		if strings.HasPrefix(name, "xl/drawings/") || strings.HasPrefix(name, "xl/media/") {
			continue
		}
		reader, openErr := entry.Open()
		if openErr != nil {
			_ = closeWithError(openErr)
			_ = os.Remove(temporary)
			return openErr
		}
		data, readErr := io.ReadAll(reader)
		_ = reader.Close()
		if readErr != nil {
			_ = closeWithError(readErr)
			_ = os.Remove(temporary)
			return readErr
		}
		if strings.HasPrefix(name, "xl/worksheets/sheet") && strings.HasSuffix(name, ".xml") {
			data = xlsxDrawingElement.ReplaceAll(data, nil)
		} else if strings.HasPrefix(name, "xl/worksheets/_rels/sheet") && strings.HasSuffix(name, ".xml.rels") {
			data = removeXMLTagsContaining(data, xlsxDrawingRelation, []byte("/drawing"))
		} else if name == "[content_types].xml" {
			data = removeXMLTagsContaining(data, xlsxDrawingOverride, []byte("/xl/drawings/"))
		}
		header := entry.FileHeader
		writer, createErr := archive.CreateHeader(&header)
		if createErr == nil {
			_, createErr = io.Copy(writer, bytes.NewReader(data))
		}
		if createErr != nil {
			_ = closeWithError(createErr)
			_ = os.Remove(temporary)
			return createErr
		}
	}
	if err := source.Close(); err != nil {
		_ = closeWithError(err)
		_ = os.Remove(temporary)
		return err
	}
	if err := closeWithError(nil); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	if err := os.Rename(path, backup); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Rename(backup, path)
		_ = os.Remove(temporary)
		return err
	}
	return os.Remove(backup)
}
