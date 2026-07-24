package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed tool_catalog.json
var catalogJSON []byte

var catalog = mustLoadCatalog()

func mustLoadCatalog() []Tool {
	var tools []Tool
	if err := json.Unmarshal(catalogJSON, &tools); err != nil {
		panic(fmt.Sprintf("invalid embedded tool catalog: %v", err))
	}
	if len(tools) == 0 {
		panic("embedded tool catalog is empty")
	}
	return tools
}

func findTool(key string) (Tool, bool) {
	for _, tool := range catalog {
		if tool.Key == key {
			return tool, true
		}
	}
	return Tool{}, false
}
