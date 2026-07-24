package validator

import (
	"fmt"
	"strings"

	"github.com/flowcanvas/flowcanvas-backend-sdk/graph"
	"github.com/flowcanvas/flowcanvas-backend-sdk/schema"
	"github.com/flowcanvas/flowcanvas-backend-sdk/topology"
)

const (
	DuplicateNodeID          = "DUPLICATE_NODE_ID"
	DuplicateEdgeID          = "DUPLICATE_EDGE_ID"
	UnknownNodeType          = "UNKNOWN_NODE_TYPE"
	MissingSourceNode        = "MISSING_SOURCE_NODE"
	MissingTargetNode        = "MISSING_TARGET_NODE"
	MissingSourcePort        = "MISSING_SOURCE_PORT"
	MissingTargetPort        = "MISSING_TARGET_PORT"
	SelfConnection           = "SELF_CONNECTION"
	DuplicateConnection      = "DUPLICATE_CONNECTION"
	PortTypeMismatch         = "PORT_TYPE_MISMATCH"
	PortCardinality          = "PORT_CARDINALITY"
	RequiredInputMissing     = "REQUIRED_INPUT_MISSING"
	CycleDetected            = "CYCLE_DETECTED"
	NodeConfigurationInvalid = "NODE_CONFIGURATION_INVALID"
	SchemaVersionInvalid     = "SCHEMA_VERSION_INVALID"
)

type GraphValidationError struct {
	Result graph.ValidationResult
}

func (e GraphValidationError) Error() string {
	parts := make([]string, 0, len(e.Result.Issues))
	for _, issue := range e.Result.Issues {
		if issue.Severity == graph.SeverityError {
			parts = append(parts, issue.Message)
		}
	}
	if len(parts) == 0 {
		return "graph validation failed"
	}
	return strings.Join(parts, "; ")
}

func Validate(g *graph.GraphDocument, registry *schema.Registry) graph.ValidationResult {
	issues := []graph.ValidationIssue{}
	if g == nil {
		return graph.ValidationResult{Valid: false, Issues: []graph.ValidationIssue{{
			Code: SchemaVersionInvalid, Severity: graph.SeverityError, Message: "图文档不能为空",
		}}}
	}
	g.Normalize()
	if g.SchemaVersion != graph.CurrentSchemaVersion {
		issues = append(issues, graph.ValidationIssue{Code: SchemaVersionInvalid, Severity: graph.SeverityError, Message: fmt.Sprintf("不支持的 schemaVersion：%d", g.SchemaVersion)})
	}

	nodeMap := map[graph.NodeID]graph.Node{}
	definitions := map[graph.NodeID]schema.NodeDefinition{}
	for _, node := range g.Nodes {
		if node.ID == "" {
			issues = append(issues, graph.ValidationIssue{Code: DuplicateNodeID, Severity: graph.SeverityError, Message: "节点 ID 不能为空"})
			continue
		}
		if _, exists := nodeMap[node.ID]; exists {
			issues = append(issues, graph.ValidationIssue{Code: DuplicateNodeID, Severity: graph.SeverityError, Message: "节点 ID 重复：" + node.ID, NodeID: node.ID})
			continue
		}
		nodeMap[node.ID] = node
		definition, ok := registry.Get(node.Type)
		if !ok {
			issues = append(issues, graph.ValidationIssue{Code: UnknownNodeType, Severity: graph.SeverityError, Message: "未注册节点类型：" + node.Type, NodeID: node.ID})
			continue
		}
		definitions[node.ID] = definition
		for _, field := range definition.RequiredDataFields {
			if strings.TrimSpace(graph.DataString(node.Data, field)) == "" {
				issues = append(issues, graph.ValidationIssue{
					Code: NodeConfigurationInvalid, Severity: graph.SeverityError,
					Message: "节点参数不能为空：" + field, NodeID: node.ID,
					Details: map[string]any{"field": field},
				})
			}
		}
		if definition.Validate != nil {
			for _, issue := range definition.Validate(node) {
				if issue.Severity == "" {
					issue.Severity = graph.SeverityError
				}
				if issue.NodeID == "" {
					issue.NodeID = node.ID
				}
				issues = append(issues, issue)
			}
		}
	}

	edgeIDs := map[graph.EdgeID]struct{}{}
	connections := map[string]struct{}{}
	incomingByPort := map[string][]graph.Edge{}
	for _, edge := range g.Edges {
		if edge.ID == "" {
			issues = append(issues, graph.ValidationIssue{Code: DuplicateEdgeID, Severity: graph.SeverityError, Message: "连线 ID 不能为空"})
			continue
		}
		if _, exists := edgeIDs[edge.ID]; exists {
			issues = append(issues, graph.ValidationIssue{Code: DuplicateEdgeID, Severity: graph.SeverityError, Message: "连线 ID 重复：" + edge.ID, EdgeID: edge.ID})
		}
		edgeIDs[edge.ID] = struct{}{}

		source, hasSource := nodeMap[edge.Source]
		target, hasTarget := nodeMap[edge.Target]
		if !hasSource {
			issues = append(issues, graph.ValidationIssue{Code: MissingSourceNode, Severity: graph.SeverityError, Message: "找不到源节点：" + edge.Source, EdgeID: edge.ID})
		}
		if !hasTarget {
			issues = append(issues, graph.ValidationIssue{Code: MissingTargetNode, Severity: graph.SeverityError, Message: "找不到目标节点：" + edge.Target, EdgeID: edge.ID})
		}
		if !hasSource || !hasTarget {
			continue
		}
		if source.ID == target.ID {
			issues = append(issues, graph.ValidationIssue{Code: SelfConnection, Severity: graph.SeverityError, Message: "节点不能连接自身", EdgeID: edge.ID, NodeID: source.ID})
		}
		connectionKey := fmt.Sprintf("%s:%s->%s:%s", edge.Source, edge.SourcePort, edge.Target, edge.TargetPort)
		if _, exists := connections[connectionKey]; exists {
			issues = append(issues, graph.ValidationIssue{Code: DuplicateConnection, Severity: graph.SeverityError, Message: "存在重复连线", EdgeID: edge.ID})
		}
		connections[connectionKey] = struct{}{}

		sourceDef := definitions[source.ID]
		targetDef := definitions[target.ID]
		sourcePort, sourcePortOK := sourceDef.Output(edge.SourcePort)
		targetPort, targetPortOK := targetDef.Input(edge.TargetPort)
		if !sourcePortOK {
			issues = append(issues, graph.ValidationIssue{Code: MissingSourcePort, Severity: graph.SeverityError, Message: "源端口不存在：" + edge.SourcePort, EdgeID: edge.ID, NodeID: source.ID, PortID: edge.SourcePort})
		}
		if !targetPortOK {
			issues = append(issues, graph.ValidationIssue{Code: MissingTargetPort, Severity: graph.SeverityError, Message: "目标端口不存在：" + edge.TargetPort, EdgeID: edge.ID, NodeID: target.ID, PortID: edge.TargetPort})
		}
		if sourcePortOK && targetPortOK && !schema.Compatible(sourcePort.DataType, targetPort.DataType) {
			issues = append(issues, graph.ValidationIssue{
				Code: PortTypeMismatch, Severity: graph.SeverityError,
				Message: fmt.Sprintf("端口类型不兼容：%s → %s", sourcePort.DataType, targetPort.DataType),
				EdgeID:  edge.ID,
				Details: map[string]any{"sourceType": sourcePort.DataType, "targetType": targetPort.DataType},
			})
		}
		incomingKey := fmt.Sprintf("%s:%s", edge.Target, edge.TargetPort)
		incomingByPort[incomingKey] = append(incomingByPort[incomingKey], edge)
		if targetPortOK && !targetPort.Multiple && len(incomingByPort[incomingKey]) > 1 {
			issues = append(issues, graph.ValidationIssue{Code: PortCardinality, Severity: graph.SeverityError, Message: "端口只允许一个输入：" + targetPort.Label, EdgeID: edge.ID, NodeID: target.ID, PortID: targetPort.ID})
		}
	}

	for _, node := range g.Nodes {
		definition, ok := definitions[node.ID]
		if !ok {
			continue
		}
		for _, port := range definition.Inputs {
			if port.Required && len(incomingByPort[fmt.Sprintf("%s:%s", node.ID, port.ID)]) == 0 {
				issues = append(issues, graph.ValidationIssue{Code: RequiredInputMissing, Severity: graph.SeverityError, Message: "缺少必填输入：" + port.Label, NodeID: node.ID, PortID: port.ID})
			}
		}
	}

	topo := topology.Analyze(g)
	if len(topo.CyclicNodeIDs) > 0 {
		issues = append(issues, graph.ValidationIssue{
			Code: CycleDetected, Severity: graph.SeverityError,
			Message: "工作流包含环路：" + strings.Join(topo.CyclicNodeIDs, ", "),
			Details: map[string]any{"nodeIds": topo.CyclicNodeIDs},
		})
	}

	return graph.ValidationResult{Valid: !hasErrors(issues), Issues: issues}
}

func hasErrors(issues []graph.ValidationIssue) bool {
	for _, issue := range issues {
		if issue.Severity == graph.SeverityError {
			return true
		}
	}
	return false
}
