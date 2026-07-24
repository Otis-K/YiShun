package main

import (
	"bytes"
	"fmt"
	"os"
	"strings"
)

func runPDF(req Request) Response {
	if req.Tool == "pdf-page-numbers" {
		return runPDFPageNumbers(req)
	}
	return runEngine(req)
}

func validatePDFInput(input string, tool Tool) error {
	if tool.Category != "PDF 工具" || !strings.EqualFold(".pdf", strings.ToLower(filepathExt(input))) {
		return nil
	}
	file, err := os.Open(input)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if info.Size() < 8 {
		return fmt.Errorf("not a valid PDF: file is too small")
	}
	header := make([]byte, 5)
	if _, err := file.ReadAt(header, 0); err != nil {
		return fmt.Errorf("not a valid PDF: %w", err)
	}
	if !bytes.Equal(header, []byte("%PDF-")) {
		return fmt.Errorf("not a valid PDF: missing %%PDF header")
	}
	tailSize := int64(1024)
	if info.Size() < tailSize {
		tailSize = info.Size()
	}
	tail := make([]byte, tailSize)
	if _, err := file.ReadAt(tail, info.Size()-tailSize); err != nil {
		return fmt.Errorf("not a valid PDF: %w", err)
	}
	if !bytes.Contains(tail, []byte("%%EOF")) {
		return fmt.Errorf("not a valid PDF: missing EOF marker")
	}
	return nil
}

func filepathExt(input string) string {
	for index := len(input) - 1; index >= 0; index-- {
		if input[index] == '.' {
			return input[index:]
		}
		if input[index] == '\\' || input[index] == '/' {
			return ""
		}
	}
	return ""
}
