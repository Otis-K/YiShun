package topology

import "github.com/flowcanvas/flowcanvas-backend-sdk/graph"

type Result struct {
	Order         []graph.NodeID   `json:"order"`
	Layers        [][]graph.NodeID `json:"layers"`
	CyclicNodeIDs []graph.NodeID   `json:"cyclicNodeIds"`
}

func Analyze(g *graph.GraphDocument) Result {
	if g == nil {
		return Result{}
	}
	nodeOrder := make([]graph.NodeID, 0, len(g.Nodes))
	nodeSet := map[graph.NodeID]struct{}{}
	inDegree := map[graph.NodeID]int{}
	outgoing := map[graph.NodeID][]graph.Edge{}
	for _, node := range g.Nodes {
		if _, exists := nodeSet[node.ID]; exists {
			continue
		}
		nodeOrder = append(nodeOrder, node.ID)
		nodeSet[node.ID] = struct{}{}
		inDegree[node.ID] = 0
		outgoing[node.ID] = []graph.Edge{}
	}
	for _, edge := range g.Edges {
		if _, ok := nodeSet[edge.Source]; !ok {
			continue
		}
		if _, ok := nodeSet[edge.Target]; !ok {
			continue
		}
		outgoing[edge.Source] = append(outgoing[edge.Source], edge)
		inDegree[edge.Target]++
	}

	frontier := make([]graph.NodeID, 0)
	for _, id := range nodeOrder {
		if inDegree[id] == 0 {
			frontier = append(frontier, id)
		}
	}

	order := make([]graph.NodeID, 0, len(nodeOrder))
	layers := [][]graph.NodeID{}
	processed := map[graph.NodeID]struct{}{}
	for len(frontier) > 0 {
		layer := append([]graph.NodeID(nil), frontier...)
		layers = append(layers, layer)
		next := []graph.NodeID{}
		for _, id := range frontier {
			order = append(order, id)
			processed[id] = struct{}{}
			for _, edge := range outgoing[id] {
				inDegree[edge.Target]--
				if inDegree[edge.Target] == 0 {
					next = append(next, edge.Target)
				}
			}
		}
		frontier = next
	}

	cyclic := []graph.NodeID{}
	for _, id := range nodeOrder {
		if _, ok := processed[id]; !ok {
			cyclic = append(cyclic, id)
		}
	}

	return Result{Order: order, Layers: layers, CyclicNodeIDs: cyclic}
}

func WouldCreateCycle(g *graph.GraphDocument, source, target graph.NodeID) bool {
	if source == target {
		return true
	}
	outgoing := map[graph.NodeID][]graph.NodeID{}
	for _, node := range g.Nodes {
		outgoing[node.ID] = []graph.NodeID{}
	}
	for _, edge := range g.Edges {
		outgoing[edge.Source] = append(outgoing[edge.Source], edge.Target)
	}
	outgoing[source] = append(outgoing[source], target)

	stack := []graph.NodeID{target}
	visited := map[graph.NodeID]struct{}{}
	for len(stack) > 0 {
		current := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if current == source {
			return true
		}
		if _, ok := visited[current]; ok {
			continue
		}
		visited[current] = struct{}{}
		stack = append(stack, outgoing[current]...)
	}
	return false
}
